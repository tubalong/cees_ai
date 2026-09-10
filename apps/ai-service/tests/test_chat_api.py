from __future__ import annotations

import json
from collections.abc import Sequence

from fastapi.testclient import TestClient

from app.core.config import ModelRole
from app.core.errors import ProviderTransientError
from app.llm.router import LLMRouter
from app.llm.types import ProviderStreamChunk, TokenUsageData
from app.main import create_app
from tests.helpers import (
    StubProvider,
    catalog,
    chat_config,
    profile,
    ready_runtime,
    result,
)


def build_chat_client(
    *,
    outcomes: Sequence[object] = (),
    stream_outcomes: Sequence[Sequence[object]] = (),
) -> tuple[TestClient, StubProvider]:
    model_profile = profile()
    provider = StubProvider(
        model_profile,
        outcomes,
        stream_outcomes=stream_outcomes,
    )
    model_catalog = catalog(
        {"primary": model_profile},
        {
            ModelRole.default: ["primary"],
            ModelRole.reasoning: ["primary"],
        },
        chat=chat_config(),
    )
    router = LLMRouter(model_catalog, lambda _name, _profile: provider)
    return TestClient(create_app(runtime=ready_runtime(router, model_catalog))), provider


def chat_payload(*, mode: str = "standard") -> dict[str, object]:
    return {
        "request_id": "req-chat-api-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "conversation_id": "conversation-1",
        "mode": mode,
        "instructions": "Answer concisely.",
        "conversation_summary": "The project name is CEES AI.",
        "messages": [
            {"role": "user", "content": "What is the project name?"},
        ],
    }


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


def test_chat_requires_internal_token() -> None:
    client, _ = build_chat_client(outcomes=[result("unused")])

    with client:
        response = client.post("/internal/v1/chat/invoke", json=chat_payload())

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INTERNAL_AUTH_FAILED"


def test_chat_invoke_returns_context_and_execution_metadata() -> None:
    client, provider = build_chat_client(outcomes=[result("The project is CEES AI.")])

    with client:
        response = client.post(
            "/internal/v1/chat/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=chat_payload(),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["conversation_id"] == "conversation-1"
    assert body["mode"] == "standard"
    assert body["message"] == {
        "role": "assistant",
        "content": "The project is CEES AI.",
    }
    assert body["context_usage"]["strategy"] == "summary_plus_recent"
    assert body["execution"]["profile"] == "primary"
    assert provider.calls[0][1].reasoning_effort is None
    assert "The project name is CEES AI." in provider.calls[0][0][2].content


def test_ultra_chat_stream_emits_reasoning_and_answering_status() -> None:
    client, provider = build_chat_client(
        stream_outcomes=[
            [
                ProviderStreamChunk(text="CEES "),
                ProviderStreamChunk(text="AI"),
                ProviderStreamChunk(
                    token_usage=TokenUsageData(
                        input_tokens=10,
                        output_tokens=2,
                        total_tokens=12,
                    ),
                    finish_reason="stop",
                ),
            ]
        ]
    )

    with client:
        response = client.post(
            "/internal/v1/chat/stream",
            headers={"X-AI-Internal-Token": "secret"},
            json=chat_payload(mode="ultra"),
        )

    assert response.status_code == 200
    events = parse_sse_events(response.text)
    assert [name for name, _data in events] == [
        "started",
        "status",
        "status",
        "content_delta",
        "content_delta",
        "usage",
        "completed",
    ]
    assert events[0][1]["mode"] == "ultra"
    assert events[1][1]["phase"] == "reasoning"
    assert events[2][1]["phase"] == "answering"
    assert events[2][1]["execution"]["profile"] == "primary"
    assert events[5][1]["token_usage"]["total_tokens"] == 12
    assert provider.stream_calls[0][1].reasoning_effort == "high"


def test_chat_compact_returns_reusable_summary() -> None:
    client, _ = build_chat_client(outcomes=[result("Project: CEES AI.")])
    payload = {
        "request_id": "req-chat-compact-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "conversation_id": "conversation-1",
        "messages": [
            {"id": "message-1", "role": "user", "content": "Project is CEES AI."},
            {"id": "message-2", "role": "assistant", "content": "Understood."},
        ],
    }

    with client:
        response = client.post(
            "/internal/v1/chat/compact",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )

    assert response.status_code == 200
    assert response.json()["summary"] == "Project: CEES AI."
    assert response.json()["summarized_through_message_id"] == "message-2"


def test_chat_invoke_post_execution_error_returns_usage_metadata() -> None:
    client, _ = build_chat_client(outcomes=[result("")])

    with client:
        response = client.post(
            "/internal/v1/chat/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=chat_payload(),
        )

    assert response.status_code == 502
    body = response.json()
    assert body["error"]["code"] == "CHAT_OUTPUT_INVALID"
    assert body["execution"]["model"] == "openai_compatible-model"
    assert body["execution"]["token_usage"]["total_tokens"] == 5


def test_chat_compact_truncation_returns_usage_metadata() -> None:
    client, _ = build_chat_client(outcomes=[result("partial summary", finish_reason="length")])
    payload = {
        "request_id": "req-chat-compact-truncated",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "conversation_id": "conversation-1",
        "messages": [
            {"id": "message-1", "role": "user", "content": "Project is CEES AI."},
        ],
    }

    with client:
        response = client.post(
            "/internal/v1/chat/compact",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )

    assert response.status_code == 502
    body = response.json()
    assert body["error"]["code"] == "CHAT_COMPACTION_TRUNCATED"
    assert body["execution"]["finish_reason"] == "length"
    assert body["execution"]["token_usage"]["total_tokens"] == 5


def test_chat_rejects_assistant_as_final_message() -> None:
    client, _ = build_chat_client(outcomes=[result("unused")])
    payload = chat_payload()
    payload["messages"] = [{"role": "assistant", "content": "done"}]

    with client:
        response = client.post(
            "/internal/v1/chat/invoke",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CHAT_REQUEST"
    assert "execution" not in response.json()


def test_chat_stream_emits_terminal_error_after_partial_output() -> None:
    client, _ = build_chat_client(
        stream_outcomes=[
            [
                ProviderStreamChunk(text="partial"),
                ProviderTransientError("disconnected"),
            ]
        ]
    )

    with client:
        response = client.post(
            "/internal/v1/chat/stream",
            headers={"X-AI-Internal-Token": "secret"},
            json=chat_payload(),
        )

    events = parse_sse_events(response.text)
    assert [name for name, _data in events] == [
        "started",
        "status",
        "content_delta",
        "error",
    ]
    assert events[-1][1]["error"]["code"] == "CHAT_STREAM_INTERRUPTED"
