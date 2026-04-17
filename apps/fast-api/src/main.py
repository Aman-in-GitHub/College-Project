import os
import re
import tempfile
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from paddleocr import TableRecognitionPipelineV2
from pydantic import BaseModel

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".pdf"}


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

    if not dfs:
        return None

    df = dfs[0].fillna("")
    columns = []

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


def parse_tables(results) -> list[Table]:
    tables: list[Table] = []

    for res in results:
        payload = getattr(res, "json", {}) or {}
        table_list = payload.get("table_res_list", [])

        for table in table_list:
            html = table.get("pred_html", "")
            if not html:
                continue

            parsed = html_to_table(html)
            if parsed:
                tables.append(parsed)

    return tables


@app.get("/")
def root():
    return {"message": "Hello World!"}


@app.post("/scan-table", response_model=ScanResponse)
async def scan_table(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    suffix = os.path.splitext(file.filename)[-1].lower()
    if suffix not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type.")

    tmp_path = None
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty file.")

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        results = app.state.pipeline.predict(tmp_path)
        tables = parse_tables(results)

        if not tables:
            raise HTTPException(
                status_code=422,
                detail={"success": False, "data": {"tables": []}},
            )

        return ScanResponse(success=True, data={"tables": tables})

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
