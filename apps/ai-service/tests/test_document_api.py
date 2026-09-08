from __future__ import annotations

import json
from io import BytesIO

from docx import Document as WordDocument
from fastapi.testclient import TestClient

from app.core.config import ModelRole, OutputMode, Settings
from app.core.runtime import AppRuntime
from app.llm.router import LLMRouter
from app.main import create_app
from tests.helpers import StubProvider, catalog, profile, ready_runtime, result


def document_data() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "title": "Implementation plan",
        "subtitle": None,
        "sections": [
            {
                "heading": "Scope",
                "level": 1,
                "blocks": [
                    {"type": "paragraph", "text": "Ship the document generation MVP."},
                    {
                        "type": "table",
                        "columns": ["Stage", "Status"],
                        "rows": [["Compose", "Ready"]],
                    },
                ],
            }
        ],
        "source_refs": ["requirements"],
    }


def compose_payload() -> dict[str, object]:
    return {
        "request_id": "req-document-api-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "instruction": "Create an implementation plan",
        "source_materials": [{"id": "requirements", "content": "Ship the MVP"}],
        "document_options": {
            "title": "Implementation plan",
            "locale": "en-US",
            "template_id": "business-standard",
            "include_toc": False,
        },
        "temperature": 0.2,
        "max_output_tokens": 2048,
    }


def quality_compose_payload() -> dict[str, object]:
    payload = compose_payload()
    payload["document_options"] = {
        **payload["document_options"],
        "generation_mode": "quality",
        "planning_max_output_tokens": 1024,
        "planning_reasoning_effort": "low",
    }
    return payload


def render_payload() -> dict[str, object]:
    return {
        "request_id": "req-document-render-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "document": document_data(),
        "document_options": {
            "locale": "en-US",
            "template_id": "business-standard",
            "include_toc": False,
        },
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
                "key_points": ["Compose", "Render"],
                "source_refs": ["requirements"],
            }
        ],
    }


def build_client(*, quality: bool = False) -> tuple[TestClient, StubProvider]:
    modes = {OutputMode.text, OutputMode.json_schema} if quality else {OutputMode.json_schema}
    model_profile = profile(modes=modes)
    outcomes = (
        [result(json.dumps(plan_data())), result(document_data())]
        if quality
        else [result(document_data())] * 2
    )
    provider = StubProvider(model_profile, outcomes)
    roles = {ModelRole.structured: ["structured"]}
    if quality:
        roles[ModelRole.reasoning] = ["structured"]
    model_catalog = catalog(
        {"structured": model_profile},
        roles,
    )
    router = LLMRouter(model_catalog, lambda _name, _profile: provider)
    app = create_app(runtime=ready_runtime(router, model_catalog))
    return TestClient(app), provider


def test_document_endpoints_require_internal_token() -> None:
    client, _ = build_client()
    requests = [
        ("/internal/v1/documents/compose", compose_payload()),
        ("/internal/v1/documents/render-docx", render_payload()),
        ("/internal/v1/documents/generate-docx", compose_payload()),
    ]

    with client:
        responses = [client.post(path, json=payload) for path, payload in requests]

    assert [response.status_code for response in responses] == [401, 401, 401]


def test_compose_returns_document_and_execution_metadata() -> None:
    client, provider = build_client()

    with client:
        response = client.post(
            "/internal/v1/documents/compose",
            headers={"X-AI-Internal-Token": "secret"},
            json=compose_payload(),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["document"]["title"] == "Implementation plan"
    assert body["execution"]["profile"] == "structured"
    assert body["execution"]["finish_reason"] == "stop"
    assert body["plan"] is None
    assert body["planning_execution"] is None
    assert len(provider.calls) == 1


def test_quality_compose_returns_plan_and_both_execution_metadata() -> None:
    client, provider = build_client(quality=True)

    with client:
        response = client.post(
            "/internal/v1/documents/compose",
            headers={"X-AI-Internal-Token": "secret"},
            json=quality_compose_payload(),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["plan"]["objective"] == "Define the MVP delivery approach"
    assert body["planning_execution"]["profile"] == "structured"
    assert body["execution"]["profile"] == "structured"
    assert [call[1].output_mode for call in provider.calls] == [
        OutputMode.text,
        OutputMode.json_schema,
    ]


def test_quality_generate_returns_docx_after_planning_and_composition() -> None:
    client, provider = build_client(quality=True)

    with client:
        response = client.post(
            "/internal/v1/documents/generate-docx",
            headers={"X-AI-Internal-Token": "secret"},
            json=quality_compose_payload(),
        )

    assert response.status_code == 200
    assert response.content.startswith(b"PK")
    assert [call[1].output_mode for call in provider.calls] == [
        OutputMode.text,
        OutputMode.json_schema,
    ]


def test_render_returns_docx_without_invoking_model() -> None:
    client, provider = build_client()

    with client:
        response = client.post(
            "/internal/v1/documents/render-docx",
            headers={"X-AI-Internal-Token": "secret"},
            json=render_payload(),
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] == "req-document-render-1"
    assert not provider.calls
    document = WordDocument(BytesIO(response.content))
    assert document.core_properties.title == "Implementation plan"


def test_generate_returns_docx_with_execution_headers() -> None:
    client, provider = build_client()

    with client:
        response = client.post(
            "/internal/v1/documents/generate-docx",
            headers={"X-AI-Internal-Token": "secret"},
            json=compose_payload(),
        )

    assert response.status_code == 200
    assert response.content.startswith(b"PK")
    assert response.headers["x-ai-profile"] == "structured"
    assert response.headers["x-ai-finish-reason"] == "stop"
    assert 'filename="document.docx"' in response.headers["content-disposition"]
    assert len(provider.calls) == 1


def test_render_remains_available_when_model_runtime_is_not_ready() -> None:
    runtime = AppRuntime(
        settings=Settings(node_env="test", ai_internal_token="secret"),
        catalog=None,
        router=None,
        readiness_errors=["model unavailable"],
    )
    client = TestClient(create_app(runtime=runtime))

    with client:
        render_response = client.post(
            "/internal/v1/documents/render-docx",
            headers={"X-AI-Internal-Token": "secret"},
            json=render_payload(),
        )
        compose_response = client.post(
            "/internal/v1/documents/compose",
            headers={"X-AI-Internal-Token": "secret"},
            json=compose_payload(),
        )

    assert render_response.status_code == 200
    assert compose_response.status_code == 503
    assert compose_response.json()["error"]["code"] == "AI_SERVICE_NOT_READY"