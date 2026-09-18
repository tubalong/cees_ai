from __future__ import annotations

import json

import pytest

from app.api.generated.models import ComposeDocumentRequest
from app.core.config import ModelRole, OutputMode
from app.core.errors import AIServiceError
from app.documents.composer import MAX_COMPOSE_ATTEMPTS, DocumentComposer
from app.llm.router import LLMRouter
from tests.helpers import StubProvider, catalog, profile, result


def request_data() -> dict[str, object]:
    return {
        "request_id": "req-document-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "instruction": "Create an implementation plan",
        "source_materials": [
            {"id": "requirements", "title": "Requirements", "content": "Ship an MVP"}
        ],
        "document_options": {
            "title": "Implementation plan",
            "locale": "en-US",
            "template_id": "business-standard",
            "include_toc": False,
        },
        "temperature": 0.2,
        "max_output_tokens": 2048,
    }


def document_data(*, source_refs: list[str] | None = None) -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "title": "Implementation plan",
        "subtitle": "MVP",
        "sections": [
            {
                "heading": "Scope",
                "level": 1,
                "blocks": [{"type": "paragraph", "text": "Ship the first release."}],
            }
        ],
        "source_refs": source_refs if source_refs is not None else ["requirements"],
    }


def plan_data() -> dict[str, object]:
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
                "key_points": ["Ship the first release"],
                "source_refs": ["requirements"],
            }
        ],
    }


def build_composer(
    output: dict[str, object], *, finish_reason: str = "stop", repeat: int = 1
) -> tuple[DocumentComposer, StubProvider]:
    model_profile = profile(modes={OutputMode.json_schema})
    provider = StubProvider(
        model_profile,
        [result(output, finish_reason=finish_reason)] * repeat,
    )
    router = LLMRouter(
        catalog({"structured": model_profile}, {ModelRole.structured: ["structured"]}),
        lambda _name, _profile: provider,
    )
    return DocumentComposer(router), provider


@pytest.mark.asyncio
async def test_composes_valid_document_spec() -> None:
    composer, provider = build_composer(document_data())

    composition = await composer.compose(ComposeDocumentRequest.model_validate(request_data()))

    assert composition.document.title == "Implementation plan"
    assert composition.document.source_refs == ["requirements"]
    assert provider.calls[0][1].output_mode == OutputMode.json_schema
    assert provider.calls[0][1].schema_name == "DocumentSpec"
    assert provider.calls[0][1].max_output_tokens == 2048
    assert composition.plan is None
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_quality_mode_plans_before_composing_document() -> None:
    model_profile = profile(modes={OutputMode.text, OutputMode.json_schema})
    provider = StubProvider(
        model_profile,
        [result(json.dumps(plan_data())), result(document_data())],
    )
    router = LLMRouter(
        catalog(
            {"primary": model_profile},
            {
                ModelRole.reasoning: ["primary"],
                ModelRole.structured: ["primary"],
            },
        ),
        lambda _name, _profile: provider,
    )
    payload = request_data()
    payload["document_options"] = {
        **payload["document_options"],
        "generation_mode": "quality",
        "planning_max_output_tokens": 1024,
    }

    composition = await DocumentComposer(router).compose(
        ComposeDocumentRequest.model_validate(payload)
    )

    assert composition.plan is not None
    assert composition.plan.objective == "Define the MVP delivery approach"
    assert composition.planning_routing is not None
    assert [call[1].output_mode for call in provider.calls] == [
        OutputMode.text,
        OutputMode.json_schema,
    ]
    assert provider.calls[0][1].max_output_tokens == 1024
    compose_prompt = json.loads(provider.calls[1][0][1].content)
    assert compose_prompt["document_plan"]["sections"][0]["heading"] == "Scope"


@pytest.mark.asyncio
async def test_rejects_truncated_document() -> None:
    composer, _ = build_composer(document_data(), finish_reason="length")

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_GENERATION_TRUNCATED"
    assert raised.value.status_code == 502


@pytest.mark.asyncio
async def test_maps_invalid_provider_structure_to_document_error() -> None:
    # 结构化输出不合规会重试 MAX_COMPOSE_ATTEMPTS 次；每次都不合规才最终失败。
    composer, provider = build_composer(
        {"schema_version": "1.0"}, repeat=MAX_COMPOSE_ATTEMPTS
    )

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_SPEC_INVALID"
    assert raised.value.status_code == 502
    assert len(provider.calls) == MAX_COMPOSE_ATTEMPTS


@pytest.mark.asyncio
async def test_recovers_when_a_retry_returns_valid_structure() -> None:
    model_profile = profile(modes={OutputMode.json_schema})
    provider = StubProvider(
        model_profile,
        [
            result({"schema_version": "1.0"}),
            result(document_data()),
        ],
    )
    router = LLMRouter(
        catalog({"structured": model_profile}, {ModelRole.structured: ["structured"]}),
        lambda _name, _profile: provider,
    )

    composition = await DocumentComposer(router).compose(
        ComposeDocumentRequest.model_validate(request_data())
    )

    assert composition.document.title == "Implementation plan"
    assert len(provider.calls) == 2


@pytest.mark.asyncio
async def test_rejects_unknown_source_reference() -> None:
    composer, _ = build_composer(document_data(source_refs=["not-provided"]))

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_SPEC_INVALID"
    assert raised.value.status_code == 502


@pytest.mark.asyncio
async def test_rejects_duplicate_source_material_ids() -> None:
    composer, provider = build_composer(document_data())
    payload = request_data()
    payload["source_materials"] = [
        {"id": "requirements", "content": "First"},
        {"id": "requirements", "content": "Second"},
    ]

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeDocumentRequest.model_validate(payload))

    assert raised.value.code == "INVALID_DOCUMENT_REQUEST"
    assert raised.value.status_code == 422
    assert not provider.calls


@pytest.mark.asyncio
async def test_rejects_oversized_document_input() -> None:
    composer, provider = build_composer(document_data())
    payload = request_data()
    payload["source_materials"] = [
        {"id": "first", "content": "a" * 131_072},
        {"id": "second", "content": "b" * 131_072},
    ]

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeDocumentRequest.model_validate(payload))

    assert raised.value.code == "INVALID_DOCUMENT_REQUEST"
    assert raised.value.status_code == 422
    assert not provider.calls