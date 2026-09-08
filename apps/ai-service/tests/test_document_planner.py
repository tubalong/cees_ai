from __future__ import annotations

import json

import pytest

from app.api.generated.models import ComposeDocumentRequest
from app.core.config import ModelRole
from app.core.errors import AIServiceError
from app.documents.planner import DocumentPlanner
from app.llm.router import LLMRouter
from tests.helpers import StubProvider, catalog, profile, result


def request_data() -> dict[str, object]:
    return {
        "request_id": "req-plan-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "instruction": "Create an implementation plan",
        "source_materials": [{"id": "requirements", "content": "Ship the MVP"}],
        "document_options": {
            "generation_mode": "quality",
            "planning_max_output_tokens": 1024,
            "planning_reasoning_effort": "low",
        },
        "llm_profile": "reasoning",
    }


def plan_data(*, source_refs: list[str] | None = None) -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "title": "Implementation plan",
        "audience": "Project team",
        "objective": "Define the MVP delivery approach",
        "sections": [
            {
                "heading": "Scope",
                "level": 1,
                "purpose": "Define the first release",
                "key_points": ["Compose documents", "Render DOCX"],
                "source_refs": source_refs if source_refs is not None else ["requirements"],
            }
        ],
    }


def build_planner(output: str, *, finish_reason: str = "stop") -> tuple[
    DocumentPlanner, StubProvider
]:
    model_profile = profile()
    provider = StubProvider(model_profile, [result(output, finish_reason=finish_reason)])
    router = LLMRouter(
        catalog({"reasoning": model_profile}, {ModelRole.reasoning: ["reasoning"]}),
        lambda _name, _profile: provider,
    )
    return DocumentPlanner(router), provider


@pytest.mark.asyncio
async def test_creates_valid_document_plan_with_reasoning_role() -> None:
    planner, provider = build_planner(json.dumps(plan_data()))

    planning = await planner.plan(ComposeDocumentRequest.model_validate(request_data()))

    assert planning.plan.title == "Implementation plan"
    assert planning.plan.sections[0].source_refs == ["requirements"]
    assert provider.calls[0][1].max_output_tokens == 1024
    assert provider.calls[0][1].output_mode.value == "text"
    assert provider.calls[0][1].reasoning_effort == "low"


@pytest.mark.asyncio
async def test_rejects_truncated_document_plan() -> None:
    planner, _ = build_planner(json.dumps(plan_data()), finish_reason="length")

    with pytest.raises(AIServiceError) as raised:
        await planner.plan(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_PLANNING_TRUNCATED"


@pytest.mark.asyncio
async def test_rejects_invalid_plan_json() -> None:
    planner, _ = build_planner("not-json")

    with pytest.raises(AIServiceError) as raised:
        await planner.plan(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_PLAN_INVALID"


@pytest.mark.asyncio
async def test_rejects_plan_with_unknown_source_reference() -> None:
    planner, _ = build_planner(json.dumps(plan_data(source_refs=["unknown"])))

    with pytest.raises(AIServiceError) as raised:
        await planner.plan(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_PLAN_INVALID"