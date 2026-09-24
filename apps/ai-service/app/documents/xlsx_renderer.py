from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO

from xlsxwriter import Workbook

from app.api.generated.models import SpreadsheetSpec
from app.core.errors import AIServiceError

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_INVALID_FILENAME = re.compile(r'[\x00-\x1f<>:"/\\|?*]+')
_INVALID_SHEET_NAME = re.compile(r"[\[\]:*?/\\]")
_MAX_SHEETS = 5
_MAX_ROWS = 2000
_MAX_COLUMNS = 60
_MAX_CELL_TEXT = 500


@dataclass(frozen=True)
class RenderedXlsx:
    content: bytes
    filename: str


class XlsxRenderer:
    def render(
        self,
        spreadsheet: SpreadsheetSpec,
        *,
        filename: str | None,
        request_id: str,
    ) -> RenderedXlsx:
        _validate_spreadsheet(spreadsheet, request_id=request_id)
        output = BytesIO()
        workbook = Workbook(output, {"in_memory": True, "strings_to_formulas": False})
        header_format = workbook.add_format(
            {"bold": True, "bg_color": "#E8EEF7", "border": 1, "text_wrap": True}
        )
        cell_format = workbook.add_format({"border": 1, "valign": "top"})
        try:
            for sheet in spreadsheet.sheets:
                worksheet = workbook.add_worksheet(sheet.name)
                row_offset = 0
                if sheet.columns:
                    for column_index, value in enumerate(sheet.columns):
                        worksheet.write_string(0, column_index, value, header_format)
                    row_offset = 1
                    worksheet.freeze_panes(1, 0)
                for row_index, row in enumerate(sheet.rows, start=row_offset):
                    for column_index, value in enumerate(row):
                        if value is None:
                            worksheet.write_blank(row_index, column_index, None, cell_format)
                        elif isinstance(value, (int, float)) and not isinstance(value, bool):
                            worksheet.write_number(row_index, column_index, value, cell_format)
                        else:
                            worksheet.write_string(row_index, column_index, str(value), cell_format)
                column_count = max(
                    len(sheet.columns or []),
                    max((len(row) for row in sheet.rows), default=0),
                )
                if column_count:
                    worksheet.set_column(0, column_count - 1, 18)
                worksheet.autofilter(
                    0,
                    0,
                    max(row_offset + len(sheet.rows) - 1, 0),
                    max(column_count - 1, 0),
                )
        finally:
            workbook.close()
        return RenderedXlsx(
            content=output.getvalue(),
            filename=f"{_safe_filename(filename or spreadsheet.title or 'spreadsheet')}.xlsx",
        )


def _validate_spreadsheet(spreadsheet: SpreadsheetSpec, *, request_id: str) -> None:
    if not spreadsheet.sheets or len(spreadsheet.sheets) > _MAX_SHEETS:
        _raise_invalid("Spreadsheet must contain between 1 and 5 sheets", request_id)
    names: set[str] = set()
    for sheet in spreadsheet.sheets:
        normalized_name = sheet.name.casefold()
        if normalized_name in names:
            _raise_invalid("Spreadsheet sheet names must be unique", request_id)
        names.add(normalized_name)
        if (
            _INVALID_SHEET_NAME.search(sheet.name)
            or sheet.name.startswith("'")
            or sheet.name.endswith("'")
        ):
            _raise_invalid("Spreadsheet sheet name contains reserved characters", request_id)
        if len(sheet.rows) > _MAX_ROWS:
            _raise_invalid("Spreadsheet sheet exceeds the 2000 row limit", request_id)
        if len(sheet.columns or []) > _MAX_COLUMNS:
            _raise_invalid("Spreadsheet sheet exceeds the 60 column limit", request_id)
        expected_columns = len(sheet.columns or [])
        for row in sheet.rows:
            if len(row) > _MAX_COLUMNS:
                _raise_invalid("Spreadsheet row exceeds the 60 column limit", request_id)
            if expected_columns and len(row) != expected_columns:
                _raise_invalid("Spreadsheet rows must match the header column count", request_id)
            if any(isinstance(value, str) and len(value) > _MAX_CELL_TEXT for value in row):
                _raise_invalid("Spreadsheet cell text exceeds the 500 character limit", request_id)


def _safe_filename(value: str) -> str:
    sanitized = _INVALID_FILENAME.sub("_", value).strip(" ._")
    return sanitized[:180] or "spreadsheet"


def _raise_invalid(message: str, request_id: str) -> None:
    raise AIServiceError(
        "SPREADSHEET_SPEC_INVALID",
        message,
        status_code=422,
        request_id=request_id,
    )