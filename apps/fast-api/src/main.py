import json
import logging
import os
from functools import lru_cache
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal, TypedDict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import TableRecognitionPipelineV2
from PIL import Image, UnidentifiedImageError

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

logger = logging.getLogger("college_project.fastapi_service")
logger.setLevel(logging.INFO)

DB_COLUMN_TYPES = ("text", "integer", "numeric", "boolean", "date", "time", "timestamp")
SUPPORTED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/tiff",
    "image/bmp",
}
SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif", ".bmp"}
RESERVED_IDENTIFIERS = {
    "select",
    "from",
    "where",
    "table",
    "user",
    "group",
    "order",
    "by",
    "insert",
    "update",
    "delete",
    "drop",
    "create",
    "alter",
}
DbColumnType = Literal[
    "text", "integer", "numeric", "boolean", "date", "time", "timestamp"
]


class ParsedCell(TypedDict):
    text: str
    rowspan: int
    colspan: int
    is_header: bool


class ParsedTable(TypedDict):
    rows: list[list[ParsedCell]]


app = FastAPI(title="PaddleOCR Table Scan Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def get_pipeline() -> TableRecognitionPipelineV2:
    logger.info("Initializing table recognition pipeline")
    return TableRecognitionPipelineV2()


def export_result_to_json(result: object, output_path: Path) -> object:
    save_to_json = getattr(result, "save_to_json", None)

    if not callable(save_to_json):
        raise RuntimeError("PaddleOCR result does not expose save_to_json().")

    save_to_json(str(output_path))

    with output_path.open("r", encoding="utf-8") as json_file:
        return json.load(json_file)


def write_pipeline_input(input_path: Path, file_bytes: bytes) -> None:
    try:
        with Image.open(BytesIO(file_bytes)) as image:
            converted_image = image.convert("RGB")
            converted_image.save(input_path, format="PNG")
    except UnidentifiedImageError as exc:
        raise ValueError("Uploaded file is not a readable image.") from exc


class TableHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[ParsedTable] = []
        self.current_table: ParsedTable | None = None
        self.current_row: list[ParsedCell] | None = None
        self.current_cell: ParsedCell | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value for key, value in attrs}

        if tag == "table":
            self.current_table = {"rows": []}
            return

        if tag == "tr" and self.current_table is not None:
            self.current_row = []
            return

        if tag in {"td", "th"} and self.current_row is not None:
            self.current_cell = {
                "text": "",
                "rowspan": parse_span(attributes.get("rowspan")),
                "colspan": parse_span(attributes.get("colspan")),
                "is_header": tag == "th",
            }

    def handle_data(self, data: str) -> None:
        if self.current_cell is not None:
            self.current_cell["text"] += data

    def handle_endtag(self, tag: str) -> None:
        if (
            tag in {"td", "th"}
            and self.current_cell is not None
            and self.current_row is not None
        ):
            self.current_cell["text"] = " ".join(self.current_cell["text"].split())
            self.current_row.append(self.current_cell)
            self.current_cell = None
            return

        if (
            tag == "tr"
            and self.current_row is not None
            and self.current_table is not None
        ):
            self.current_table["rows"].append(self.current_row)
            self.current_row = None
            return

        if tag == "table" and self.current_table is not None:
            self.tables.append(self.current_table)
            self.current_table = None


def parse_span(value: str | None) -> int:
    try:
        parsed_value = int(value) if value is not None else 1
    except ValueError:
        return 1

    return parsed_value if parsed_value > 0 else 1


def normalize_identifier(value: str) -> str | None:
    normalized = value.strip().lower().replace(" ", "_")
    normalized = "".join(
        character if character.isalnum() or character == "_" else "_"
        for character in normalized
    )

    while "__" in normalized:
        normalized = normalized.replace("__", "_")

    normalized = normalized.strip("_")

    if not normalized or len(normalized) > 63:
        return None

    if normalized[0].isdigit() or normalized in RESERVED_IDENTIFIERS:
        return None

    return normalized


def normalize_header(header: str, index: int) -> str:
    if not header.strip():
        return f"column_{index + 1}"

    normalized_name = normalize_identifier(header)

    if normalized_name:
        return normalized_name

    fallback_name = normalize_identifier(f"column_{header}")

    return fallback_name or f"column_{index + 1}"


def infer_column_type_from_header(header: str) -> DbColumnType:
    normalized_header = normalize_header(header, 0)

    if normalized_header in {"created_at", "updated_at", "timestamp", "datetime"}:
        return "timestamp"

    if (
        "timestamp" in normalized_header
        or "datetime" in normalized_header
        or normalized_header.endswith("_at")
    ):
        return "timestamp"

    if normalized_header in {"date", "dob", "birth_date"} or normalized_header.endswith(
        "_date"
    ):
        return "date"

    if normalized_header == "time" or normalized_header.endswith("_time"):
        return "time"

    if (
        normalized_header.startswith("is_")
        or normalized_header.startswith("has_")
        or normalized_header.startswith("can_")
        or normalized_header
        in {"active", "enabled", "verified", "available", "present"}
    ):
        return "boolean"

    if normalized_header == "id" or normalized_header.endswith("_id"):
        return "integer"

    if any(
        token in normalized_header
        for token in {"count", "qty", "quantity", "age", "year", "rank", "number", "no"}
    ):
        return "integer"

    if any(
        token in normalized_header
        for token in {
            "amount",
            "price",
            "cost",
            "total",
            "balance",
            "rate",
            "percent",
            "score",
        }
    ):
        return "numeric"

    return "text"


def extract_html_tables(
    exported_result: object, html_directory_path: Path
) -> list[str]:
    if isinstance(exported_result, dict):
        table_res_list = exported_result.get("table_res_list")

        if isinstance(table_res_list, list):
            html_tables: list[str] = []

            for table_result in table_res_list:
                if not isinstance(table_result, dict):
                    continue

                pred_html = table_result.get("pred_html")

                if isinstance(pred_html, str) and pred_html.strip():
                    html_tables.append(pred_html)

            if html_tables:
                return html_tables

    html_tables: list[str] = []

    for html_file in sorted(html_directory_path.glob("*.html")):
        html_content = html_file.read_text(encoding="utf-8").strip()

        if html_content:
            html_tables.append(html_content)

    return html_tables


def expand_table_rows(
    rows: list[list[ParsedCell]],
) -> tuple[list[list[str]], list[list[bool]]]:
    occupied_cells: dict[tuple[int, int], str] = {}
    occupied_headers: dict[tuple[int, int], bool] = {}
    max_column_index = -1

    for row_index, row in enumerate(rows):
        column_index = 0

        for cell in row:
            while (row_index, column_index) in occupied_cells:
                column_index += 1

            for row_offset in range(cell["rowspan"]):
                for column_offset in range(cell["colspan"]):
                    position = (row_index + row_offset, column_index + column_offset)
                    occupied_cells[position] = (
                        cell["text"] if row_offset == 0 and column_offset == 0 else ""
                    )
                    occupied_headers[position] = cell["is_header"]
                    max_column_index = max(
                        max_column_index, column_index + column_offset
                    )

            column_index += cell["colspan"]

    total_columns = max_column_index + 1
    expanded_rows = [
        [
            occupied_cells.get((row_index, column_index), "")
            for column_index in range(total_columns)
        ]
        for row_index in range(len(rows))
    ]
    header_flags = [
        [
            occupied_headers.get((row_index, column_index), False)
            for column_index in range(total_columns)
        ]
        for row_index in range(len(rows))
    ]

    return expanded_rows, header_flags


def get_header_row_count(header_flags: list[list[bool]]) -> int:
    header_row_count = 0

    for row in header_flags:
        if any(row):
            header_row_count += 1
            continue

        break

    return header_row_count or 1


def build_header_names(rows: list[list[str]], header_row_count: int) -> list[str]:
    if not rows:
        return []

    headers: list[str] = []

    for column_index in range(len(rows[0])):
        parts: list[str] = []

        for row_index in range(min(header_row_count, len(rows))):
            value = rows[row_index][column_index].strip()

            if value and value not in parts:
                parts.append(value)

        headers.append(" ".join(parts).strip())

    return headers


def structure_html_table(html_content: str) -> dict[str, object] | None:
    parser = TableHtmlParser()
    parser.feed(html_content)

    if not parser.tables:
        return None

    expanded_rows, header_flags = expand_table_rows(parser.tables[0]["rows"])

    if not expanded_rows or not expanded_rows[0]:
        return None

    header_row_count = get_header_row_count(header_flags)
    headers = build_header_names(expanded_rows, header_row_count)
    data_rows = expanded_rows[header_row_count:]
    columns = []

    for column_index, header in enumerate(headers):
        values = [
            row[column_index].strip() for row in data_rows if column_index < len(row)
        ]
        columns.append(
            {
                "name": normalize_header(header, column_index),
                "inferredType": infer_column_type_from_header(header),
                "values": values,
            }
        )

    if len(columns) == 0:
        return None

    return {"columns": columns}


def extract_scanned_tables(file_bytes: bytes) -> list[dict[str, object]]:
    pipeline = get_pipeline()

    with TemporaryDirectory() as temporary_directory:
        temporary_directory_path = Path(temporary_directory)
        input_path = temporary_directory_path / "upload.png"
        write_pipeline_input(input_path, file_bytes)
        results = pipeline.predict(
            str(input_path),
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_layout_detection=True,
            use_ocr_model=True,
            use_table_orientation_classify=True,
            use_ocr_results_with_table_cells=True,
        )
        scanned_tables: list[dict[str, object]] = []

        for index, result in enumerate(results):
            result_directory_path = temporary_directory_path / f"result_{index}"
            result_directory_path.mkdir(parents=True, exist_ok=True)
            exported_result = export_result_to_json(
                result, result_directory_path / "result.json"
            )
            save_to_html = getattr(result, "save_to_html", None)

            if callable(save_to_html):
                save_to_html(str(result_directory_path))

            for html_table in extract_html_tables(
                exported_result, result_directory_path
            ):
                structured_table = structure_html_table(html_table)

                if structured_table is not None:
                    scanned_tables.append(structured_table)

    return scanned_tables


@app.post("/api/table/scan")
async def scan_table(file: UploadFile = File(...)) -> dict[str, object]:
    logger.info(
        "Received table scan request filename=%s content_type=%s",
        file.filename,
        file.content_type,
    )
    upload_suffix = Path(file.filename or "").suffix.lower()

    if (
        file.content_type not in SUPPORTED_CONTENT_TYPES
        and upload_suffix not in SUPPORTED_SUFFIXES
    ):
        logger.warning(
            "Rejected upload with unsupported type filename=%s content_type=%s",
            file.filename,
            file.content_type,
        )
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Use an image file such as jpg, jpeg, png, webp, tiff, or bmp.",
        )

    file_bytes = await file.read()

    if not file_bytes:
        logger.warning("Rejected empty upload filename=%s", file.filename)
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        tables = await run_in_threadpool(extract_scanned_tables, file_bytes)
    except ValueError as exc:
        logger.warning(
            "Invalid upload content filename=%s error=%s", file.filename, exc
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Table recognition failed filename=%s error=%s", file.filename, exc
        )
        raise HTTPException(
            status_code=500, detail=f"Table recognition failed: {exc}"
        ) from exc

    logger.info(
        "Completed table scan filename=%s table_count=%s", file.filename, len(tables)
    )

    return {
        "success": True,
        "message": "Table scan complete"
        if len(tables) > 0
        else "No table found in the uploaded image",
        "data": {
            "department": None,
            "tables": tables,
            "columnTypes": list(DB_COLUMN_TYPES),
        },
    }
