from __future__ import annotations

import pytest

from app.api.generated.models import ComposeSpreadsheetRequest
from app.core.config import ModelRole, OutputMode
from app.core.errors import AIServiceError
from app.documents.spreadsheet_composer import MAX_COMPOSE_ATTEMPTS, SpreadsheetComposer
from app.llm.router import LLMRouter
from tests.helpers import StubProvider, catalog, profile, result


def request_data() -> dict[str, object]:
    return {
        "request_id": "req-sheet-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "instruction": "Increase every amount by 10 percent",
        "source_materials": [
            {"id": "file-1", "title": "income.xlsx", "content": "Project,Amount\nEast,100"}
        ],
        "title": "Adjusted income",
        "max_output_tokens": 4096,
    }


def spreadsheet_data() -> dict[str, object]:
    return {
        "title": "Adjusted income",
        "sheets": [
            {"name": "Income", "columns": ["Project", "Amount"], "rows": [["East", 110]]}
        ],
    }


def build_composer(outputs: list[object]) -> tuple[SpreadsheetComposer, StubProvider]:
    model_profile = profile(modes={OutputMode.json_schema})
    provider = StubProvider(model_profile, [result(output) for output in outputs])
    router = LLMRouter(
        catalog({"structured": model_profile}, {ModelRole.structured: ["structured"]}),
        lambda _name, _profile: provider,
    )
    return SpreadsheetComposer(router), provider


@pytest.mark.asyncio
async def test_composes_valid_spreadsheet_spec() -> None:
    composer, provider = build_composer([spreadsheet_data()])

    composition = await composer.compose(ComposeSpreadsheetRequest.model_validate(request_data()))

    assert composition.spreadsheet.title == "Adjusted income"
    assert composition.spreadsheet.sheets[0].rows == [["East", 110.0]]
    assert provider.calls[0][1].schema_name == "SpreadsheetSpec"
    assert provider.calls[0][1].output_mode == OutputMode.json_schema


@pytest.mark.asyncio
async def test_rejects_duplicate_source_material_ids() -> None:
    composer, _provider = build_composer([spreadsheet_data()])
    payload = request_data()
    payload["source_materials"] = [
        {"id": "same", "content": "one"},
        {"id": "same", "content": "two"},
    ]

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeSpreadsheetRequest.model_validate(payload))

    assert raised.value.code == "INVALID_SPREADSHEET_REQUEST"
    assert raised.value.status_code == 422


@pytest.mark.asyncio
async def test_retries_invalid_structured_output_then_fails_stably() -> None:
    composer, provider = build_composer(["invalid"] * MAX_COMPOSE_ATTEMPTS)

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeSpreadsheetRequest.model_validate(request_data()))

    assert raised.value.code == "SPREADSHEET_SPEC_INVALID"
    assert len(provider.calls) == MAX_COMPOSE_ATTEMPTS