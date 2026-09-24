from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

import pytest

from app.api.generated.models import SpreadsheetSpec
from app.core.errors import AIServiceError
from app.documents.xlsx_renderer import XlsxRenderer


def spreadsheet_data() -> dict[str, object]:
    return {
        "title": "项目收入汇总",
        "sheets": [
            {
                "name": "收入",
                "columns": ["项目", "金额", "说明"],
                "rows": [["华东项目", 12500.5, "已到账"], ["公式文本", "=1+1", None]],
            },
            {"name": "备注", "rows": [["中文内容"]]},
        ],
    }


def test_renders_openable_xlsx_with_cjk_numbers_and_formula_text() -> None:
    rendered = XlsxRenderer().render(
        SpreadsheetSpec.model_validate(spreadsheet_data()),
        filename=None,
        request_id="req-xlsx-1",
    )

    assert rendered.content.startswith(b"PK")
    assert rendered.filename == "项目收入汇总.xlsx"
    with ZipFile(BytesIO(rendered.content)) as archive:
        assert "xl/workbook.xml" in archive.namelist()
        worksheet = archive.read("xl/worksheets/sheet1.xml")
        assert b"<f>" not in worksheet


def test_rejects_duplicate_sheet_names_case_insensitively() -> None:
    payload = spreadsheet_data()
    payload["sheets"] = [{"name": "Data", "rows": []}, {"name": "data", "rows": []}]

    with pytest.raises(AIServiceError) as raised:
        XlsxRenderer().render(
            SpreadsheetSpec.model_validate(payload),
            filename="report",
            request_id="req-xlsx-2",
        )

    assert raised.value.code == "SPREADSHEET_SPEC_INVALID"
    assert raised.value.status_code == 422


def test_rejects_rows_that_do_not_match_header_width() -> None:
    payload = spreadsheet_data()
    payload["sheets"] = [{"name": "Data", "columns": ["A", "B"], "rows": [["only one"]]}]

    with pytest.raises(AIServiceError) as raised:
        XlsxRenderer().render(
            SpreadsheetSpec.model_validate(payload),
            filename="report",
            request_id="req-xlsx-3",
        )

    assert raised.value.code == "SPREADSHEET_SPEC_INVALID"


def test_rejects_reserved_sheet_name_characters() -> None:
    payload = spreadsheet_data()
    payload["sheets"] = [{"name": "Bad/Name", "rows": []}]

    with pytest.raises(AIServiceError) as raised:
        XlsxRenderer().render(
            SpreadsheetSpec.model_validate(payload),
            filename="report",
            request_id="req-xlsx-4",
        )

    assert raised.value.code == "SPREADSHEET_SPEC_INVALID"