from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.api.generated.models import ToolTurnMessage, ToolTurnRequest
from app.chat.tool_turn import ToolTurnOrchestrator
from app.core.config import ModelCapability, ModelRole
from app.core.errors import AIServiceError
from app.llm.router import LLMRouter
from app.llm.types import ProviderStreamChunk, TokenUsageData, ToolCall
from app.main import create_app
from tests.helpers import StubProvider, catalog, profile, ready_runtime


def tool_turn_payload(*, tools: list[dict[str, object]] | None = None) -> dict[str, object]:
    return {
        "request_id": "req-tool-turn-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "conversation_id": "conversation-1",
        "mode": "standard",
        "instructions": "Use tools when appropriate.",
        "messages": [
            {"role": "user", "content": "Generate a cat image."},
        ],
        "tools": tools
        if tools is not None
        else [
            {
                "name": "generate_image",
                "description": "Generate an image.",
                "parameters": {"type": "object", "properties": {"prompt": {"type": "string"}}},
            }
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


def test_tool_turn_prepare_builds_system_context_and_tools() -> None:
    request = ToolTurnRequest.model_validate(tool_turn_payload())

    prepared = ToolTurnOrchestrator().prepare(request)

    assert prepared.messages[0].role == "system"
    assert prepared.messages[0].content.startswith("You are a helpful")
    assert prepared.messages[-1].content == "Generate a cat image."
    assert prepared.tools == (
        {
            "name": "generate_image",
            "description": "Generate an image.",
            "parameters": {"type": "object", "properties": {"prompt": {"type": "string"}}},
        },
    )


def test_tool_turn_prepare_rejects_unknown_tool_message_reference() -> None:
    request = ToolTurnRequest.model_validate(
        tool_turn_payload(
            tools=[
                {
                    "name": "generate_image",
                    "description": "Generate an image.",
                    "parameters": {"type": "object"},
                }
            ]
        )
    )
    request.messages = [
        ToolTurnMessage.model_validate(
            {"role": "tool", "content": "done", "tool_call_id": "missing"}
        )
    ]

    with pytest.raises(AIServiceError) as raised:
        ToolTurnOrchestrator().prepare(request)

    assert raised.value.code == "INVALID_TOOL_TURN_REQUEST"
    assert "unknown tool call id" in raised.value.message


def test_tool_turn_stream_returns_tool_calls_event() -> None:
    tool_profile = profile(capabilities={ModelCapability.chat, ModelCapability.tool_calling})
    provider = StubProvider(
        tool_profile,
        [],
        tool_stream_outcomes=[
            [
                ProviderStreamChunk(
                    tool_calls=(
                        ToolCall(
                            id="call_1",
                            name="generate_image",
                            arguments={"prompt": "a cat"},
                        ),
                    ),
                    token_usage=TokenUsageData(
                        input_tokens=10,
                        output_tokens=4,
                        total_tokens=14,
                    ),
                    finish_reason="tool_calls",
                )
            ]
        ],
    )
    model_catalog = catalog(
        {"tool": tool_profile},
        {ModelRole.orchestrator: ["tool"]},
    )
    router = LLMRouter(model_catalog, lambda _name, _profile: provider)
    client = TestClient(create_app(runtime=ready_runtime(router, model_catalog)))

    with client:
        response = client.post(
            "/internal/v1/chat/tool-turn/stream",
            headers={"X-AI-Internal-Token": "secret"},
            json=tool_turn_payload(),
        )

    assert response.status_code == 200
    events = parse_sse_events(response.text)
    assert [name for name, _data in events] == [
        "started",
        "status",
        "tool_calls",
        "usage",
        "completed",
    ]
    assert events[1][1]["execution"] == {
        "profile": "tool",
        "provider": "openai_compatible",
        "model": "openai_compatible-model",
        "fallback_count": 0,
    }
    assert events[2][1]["tool_calls"] == [
        {
            "id": "call_1",
            "name": "generate_image",
            "arguments": {"prompt": "a cat"},
        }
    ]
    assert events[3][1]["token_usage"]["total_tokens"] == 14
