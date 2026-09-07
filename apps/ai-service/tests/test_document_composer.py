from __future__ import annotations

import pytest

from app.api.generated.models import ComposeDocumentRequest
from app.core.config import ModelRole, OutputMode
from app.core.errors import AIServiceError
from app.documents.composer import DocumentComposer
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


def build_composer(output: dict[str, object], *, finish_reason: str = "stop") -> tuple[
    DocumentComposer, StubProvider
]:
    model_profile = profile(modes={OutputMode.json_schema})
    provider = StubProvider(model_profile, [result(output, finish_reason=finish_reason)])
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


@pytest.mark.asyncio
async def test_rejects_truncated_document() -> None:
    composer, _ = build_composer(document_data(), finish_reason="length")

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_GENERATION_TRUNCATED"
    assert raised.value.status_code == 502


@pytest.mark.asyncio
async def test_maps_invalid_provider_structure_to_document_error() -> None:
    composer, _ = build_composer({"schema_version": "1.0"})

    with pytest.raises(AIServiceError) as raised:
        await composer.compose(ComposeDocumentRequest.model_validate(request_data()))

    assert raised.value.code == "DOCUMENT_SPEC_INVALID"
    assert raised.value.status_code == 502


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