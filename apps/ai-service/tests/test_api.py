from __future__ import annotations

import json
from collections.abc import Sequence

from fastapi.testclient import TestClient

from app.core.config import ModelRole, OutputMode, Settings
from app.core.errors import ProviderTransientError
from app.core.runtime import AppRuntime
from app.llm.router import LLMRouter
from app.llm.types import ProviderStreamChunk, TokenUsageData
from app.main import create_app
from tests.helpers import StubProvider, catalog, profile, ready_runtime, result


def build_client(
    *,
    structured: bool = False,
    settings: Settings | None = None,
    stream_outcomes: Sequence[Sequence[object]] = (),
) -> tuple[TestClient, StubProvider]:
    modes = {OutputMode.text, OutputMode.json_schema} if structured else {OutputMode.text}
    model_profile = profile(modes=modes)
    outcome = result({"answer": 42}) if structured else result("hello")
    provider = StubProvider(model_profile, [outcome], stream_outcomes=stream_outcomes)
    role = ModelRole.structured if structured else ModelRole.default
    model_catalog = catalog({"primary": model_profile}, {role: ["primary"]})
    router = LLMRouter(model_catalog, lambda _name, _profile: provider)
    app = create_app(runtime=ready_runtime(router, model_catalog, settings=settings))
    return TestClient(app), provider


def text_payload() -> dict[str, object]:
    return {
        "request_id": "req-api-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "messages": [{"role": "user", "content": "hello"}],
        "response_format": {"type": "text"},
    }


def stream_payload() -> dict[str, object]:
    payload = text_payload()
    payload.pop("response_format")
    return payload


def parse_sse_events(body: str) -> list[tuple[str, dict[str, object]]]:
    blocks = body.replace("\r\n", "\n").strip().split("\n\n")
    events = []
    for block in blocks:
        lines = block.splitlines()
        events.append(
            (
                lines[0].removeprefix("event: "),
                json.loads(lines[1].removeprefix("data: ")),
            )
        )
    return events


def test_health_and_readiness_do_not_require_authentication() -> None:
    client, _ = build_client()
    with client:
        assert client.get("/health").json() == {"status": "ok", "service": "ai-service"}
        readiness = client.get("/ready")
    assert readiness.status_code == 200
    assert readiness.json()["status"] == "ready"


def test_invoke_requires_internal_token() -> None:
    client, _ = build_client()
    with client:
        response = client.post("/internal/v1/llm/invoke", json=text_payload())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INTERNAL_AUTH_FAILED"


def test_text_invocation_returns_execution_metadata() -> None:
    client, provider = build_client()
    with client:
        response = client.post(
            "/internal/v1/llm/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json={**text_payload(), "temperature": 0.5, "max_output_tokens": 128},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["output"] == {"type": "text", "text": "hello"}
    assert body["execution"]["profile"] == "primary"
    assert body["execution"]["token_usage"]["total_tokens"] == 5
    assert provider.calls[0][1].max_output_tokens == 128


def test_json_schema_invocation() -> None:
    client, _ = build_client(structured=True)
    payload = {
        **text_payload(),
        "request_id": "req-api-2",
        "response_format": {
            "type": "json_schema",
            "name": "Answer",
            "schema": {
                "type": "object",
                "properties": {"answer": {"type": "integer"}},
                "required": ["answer"],
            },
        },
    }
    with client:
        response = client.post(
            "/internal/v1/llm/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )
    assert response.status_code == 200
    assert response.json()["output"] == {"type": "json", "value": {"answer": 42}}


def test_request_validation_uses_standard_error_shape() -> None:
    client, _ = build_client()
    payload = text_payload()
    payload["messages"] = []
    with client:
        response = client.post(
            "/internal/v1/llm/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_INVOCATION_REQUEST"


def test_message_total_size_is_limited() -> None:
    client, _ = build_client()
    payload = text_payload()
    payload["messages"] = [
        {"role": "user", "content": "a" * 140_000},
        {"role": "assistant", "content": "b" * 140_000},
    ]
    with client:
        response = client.post(
            "/internal/v1/llm/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_INVOCATION_REQUEST"

    payload.pop("response_format")
    with client:
        stream_response = client.post(
            "/internal/v1/llm/stream",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )
    assert stream_response.status_code == 422
    assert stream_response.json()["error"]["code"] == "INVALID_INVOCATION_REQUEST"


def test_not_ready_runtime_rejects_invocation() -> None:
    runtime = AppRuntime(
        settings=Settings(node_env="test", ai_internal_token="secret"),
        catalog=None,
        router=None,
        readiness_errors=["invalid catalog"],
    )
    client = TestClient(create_app(runtime=runtime))
    with client:
        readiness = client.get("/ready")
        response = client.post(
            "/internal/v1/llm/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=text_payload(),
        )
        stream_response = client.post(
            "/internal/v1/llm/stream",
            headers={"X-AI-Internal-Token": "secret"},
            json=stream_payload(),
        )
    assert readiness.status_code == 503
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_SERVICE_NOT_READY"
    assert stream_response.status_code == 503
    assert stream_response.json()["error"]["code"] == "AI_SERVICE_NOT_READY"


def test_docs_are_enabled_for_staging_configuration() -> None:
    settings = Settings(
        node_env="production",
        ai_internal_token="secret",
        ai_docs_enabled=True,
    )
    client, _ = build_client(settings=settings)

    with client:
        docs = client.get("/docs")
        redoc = client.get("/redoc")
        openapi = client.get("/openapi.json")
        invocation = client.post(
            "/internal/v1/llm/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=text_payload(),
        )

    assert docs.status_code == 200
    assert redoc.status_code == 200
    assert openapi.status_code == 200
    assert openapi.json()["servers"] == [
        {"url": "/", "description": "Current deployment origin"}
    ]
    assert invocation.status_code == 200


def test_docs_are_disabled_by_default_in_production() -> None:
    settings = Settings(
        node_env="production",
        ai_internal_token="secret",
    )
    client, _ = build_client(settings=settings)

    with client:
        docs = client.get("/docs")
        redoc = client.get("/redoc")
        openapi = client.get("/openapi.json")
        health = client.get("/health")
        invocation = client.post(
            "/internal/v1/llm/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=text_payload(),
        )

    assert docs.status_code == 404
    assert redoc.status_code == 404
    assert openapi.status_code == 404
    assert health.status_code == 200
    assert invocation.status_code == 200


def test_stream_requires_internal_token() -> None:
    client, _ = build_client()
    with client:
        response = client.post("/internal/v1/llm/stream", json=stream_payload())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INTERNAL_AUTH_FAILED"


def test_stream_returns_ordered_sse_events() -> None:
    client, provider = build_client(
        stream_outcomes=[
            [
                ProviderStreamChunk(text="hel"),
                ProviderStreamChunk(text="lo"),
                ProviderStreamChunk(
                    token_usage=TokenUsageData(
                        input_tokens=3,
                        output_tokens=2,
                        total_tokens=5,
                    )
                ),
            ]
        ]
    )
    with client:
        response = client.post(
            "/internal/v1/llm/stream",
            headers={"X-AI-Internal-Token": "secret"},
            json={**stream_payload(), "temperature": 0.4, "max_output_tokens": 128},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    events = parse_sse_events(response.text)
    assert [name for name, _data in events] == [
        "started",
        "content_delta",
        "content_delta",
        "usage",
        "completed",
    ]
    assert events[0][1]["execution"]["profile"] == "primary"
    assert [events[1][1]["text"], events[2][1]["text"]] == ["hel", "lo"]
    assert events[3][1]["token_usage"]["total_tokens"] == 5
    assert isinstance(events[4][1]["latency_ms"], int)
    assert provider.stream_calls[0][1].max_output_tokens == 128


def test_stream_emits_error_after_partial_output() -> None:
    client, _ = build_client(
        stream_outcomes=[
            [
                ProviderStreamChunk(text="partial"),
                ProviderTransientError("disconnected"),
            ]
        ]
    )
    with client:
        response = client.post(
            "/internal/v1/llm/stream",
            headers={"X-AI-Internal-Token": "secret"},
            json=stream_payload(),
        )

    assert response.status_code == 200
    events = parse_sse_events(response.text)
    assert [name for name, _data in events] == ["started", "content_delta", "error"]
    assert events[-1][1]["error"] == {
        "code": "LLM_STREAM_INTERRUPTED",
        "message": "The provider stream was interrupted",
        "request_id": "req-api-1",
        "retryable": True,
    }
