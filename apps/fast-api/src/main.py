import logging
import os
import re
import tempfile
from contextlib import asynccontextmanager
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import TableRecognitionPipelineV2
from PIL import Image
from pydantic import BaseModel

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".pdf"}


logger = logging.getLogger("scan-table")
logging.basicConfig(level=logging.INFO)


class Column(BaseModel):
    column: str
    pg_type: str
    values: list[str]


class Table(BaseModel):
    columns: list[Column]


class ScanResponse(BaseModel):
    success: bool
    data: dict[str, list[Table]]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pipeline = TableRecognitionPipelineV2(
        use_doc_orientation_classify=True,
        use_doc_unwarping=True,
    )
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def normalize_header(name: str, index: int) -> str:
    name = (name or "").strip()
    if not name:
        return f"column_{index + 1}"
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"\W+", "_", name)
    name = name.strip("_").lower()
    return name or f"column_{index + 1}"


def infer_value_type(value: str) -> str:
    v = value.strip()
    if not v:
        return "NULL"

    if re.fullmatch(r"true|false|yes|no", v, re.IGNORECASE):
        return "BOOLEAN"

    if re.fullmatch(r"-?\d+", v):
        return "INTEGER"

    if re.fullmatch(r"-?\d+\.\d+", v):
        return "NUMERIC"

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return "DATE"

    if re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", v):
        return "TIME"

    return "TEXT"


def collapse_types(types: list[str]) -> str:
    real = [t for t in types if t != "NULL"]
    if not real:
        return "TEXT"

    if "TEXT" in real:
        return "TEXT"

    if "NUMERIC" in real:
        return "NUMERIC"

    if set(real).issubset({"INTEGER"}):
        return "INTEGER"

    if set(real).issubset({"BOOLEAN"}):
        return "BOOLEAN"

    if set(real).issubset({"DATE"}):
        return "DATE"

    if set(real).issubset({"TIME"}):
        return "TIME"

    return "TEXT"


def html_to_table(html: str) -> Table | None:
    try:
        dfs = pd.read_html(html)
    except ValueError:
        return None
    except Exception:
        return None

    if not dfs:
        return None

    df = dfs[0].fillna("")
    columns: list[Column] = []

    for i, col_name in enumerate(df.columns):
        values = [str(v).strip() for v in df[col_name].tolist()]
        inferred = collapse_types([infer_value_type(v) for v in values])
        columns.append(
            Column(
                column=normalize_header(str(col_name), i),
                pg_type=inferred,
                values=values,
            )
        )

    return Table(columns=columns)


def parse_tables(results: list[Any]) -> list[Table]:
    tables: list[Table] = []

    for res in results:
        payload = getattr(res, "json", {}) or {}

        table_list = payload.get("table_res_list", [])
        if not isinstance(table_list, list):
            continue

        for table in table_list:
            if not isinstance(table, dict):
                continue

            html = table.get("pred_html", "")
            if not html:
                continue

            parsed = html_to_table(html)
            if parsed:
                tables.append(parsed)

    return tables


def upscale_image_if_needed(path: str) -> None:
    try:
        with Image.open(path) as img:
            w, h = img.size
            longest = max(w, h)

            if longest < 1200:
                if longest < 400:
                    scale = 4
                elif longest < 800:
                    scale = 2
                else:
                    scale = 1

                if scale > 1:
                    resized = img.resize(
                        (w * scale, h * scale),
                        Image.Resampling.LANCZOS,
                    )
                    resized.save(path)

                    logger.info(
                        f"Image upscaled by factor {scale} to size {(w * scale, h * scale)}"
                    )
                else:
                    logger.info("Image size is sufficient, no upscale needed")
            else:
                logger.info("Image size is sufficient, no upscale needed")
    except Exception:
        logger.warning("Image upscale skipped", exc_info=True)


@app.get("/")
def root():
    return {"message": "Hello World!"}


@app.post("/scan-table", response_model=ScanResponse)
async def scan_table(file: UploadFile = File(...)):
    logger.info("Received scan-table request")

    if not file.filename:
        logger.warning("Missing filename")
        raise HTTPException(status_code=400, detail="Missing filename.")

    suffix = os.path.splitext(file.filename)[-1].lower()
    if suffix not in ALLOWED_EXTS:
        logger.warning(f"Unsupported file type: {suffix}")
        raise HTTPException(status_code=400, detail="Unsupported file type.")

    tmp_path = None

    try:
        content = await file.read()
        if not content:
            logger.warning("Empty file uploaded")
            raise HTTPException(status_code=400, detail="Empty file.")

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        logger.info(f"File saved to temp path: {tmp_path}")

        if suffix in {".png", ".jpg", ".jpeg", ".bmp", ".webp"}:
            logger.info("Running image upscale check")
            upscale_image_if_needed(tmp_path)

        logger.info("Running OCR pipeline")
        results = list(app.state.pipeline.predict(tmp_path))

        logger.info(f"Pipeline returned {len(results)} results")

        tables = parse_tables(results)

        logger.info(f"Parsed {len(tables)} tables")

        if not tables:
            logger.info("No tables found")
            return ScanResponse(success=False, data={"tables": []})

        logger.info("Scan successful")
        return ScanResponse(success=True, data={"tables": tables})

    except HTTPException:
        raise
    except Exception:
        logger.exception("Scan failed")
        raise HTTPException(status_code=500, detail="Scan failed")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            logger.info("Temp file cleaned up")
