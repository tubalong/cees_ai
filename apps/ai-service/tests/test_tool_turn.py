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
from tests.helpers import StubProvider, catalog, profile, ready_runtime, text_parts


def tool_turn_payload(
    *,
    tools: list[dict[str, object]] | None = None,
    conversation_summary: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "request_id": "req-tool-turn-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "conversation_id": "conversation-1",
        "mode": "standard",
        "instructions": "Use tools when appropriate.",
        "messages": [
            {"role": "user", "content": text_parts("Generate a cat image.")},
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
    if conversation_summary is not None:
        payload["conversation_summary"] = conversation_summary
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


def test_tool_turn_prepare_builds_system_context_and_tools() -> None:
    request = ToolTurnRequest.model_validate(tool_turn_payload())

    prepared = ToolTurnOrchestrator().prepare(request)

    assert prepared.messages[0].role == "system"
    assert prepared.messages[0].content.startswith("You are a helpful")
    assert prepared.messages[-1].content == text_parts("Generate a cat image.")
    assert prepared.tools == (
        {
            "name": "generate_image",
            "description": "Generate an image.",
            "parameters": {"type": "object", "properties": {"prompt": {"type": "string"}}},
        },
    )


def test_tool_turn_prepare_sets_context_strategy_from_summary() -> None:
    without_summary = ToolTurnOrchestrator().prepare(
        ToolTurnRequest.model_validate(tool_turn_payload())
    )
    assert without_summary.context_strategy.value == "full"

    with_summary = ToolTurnOrchestrator().prepare(
        ToolTurnRequest.model_validate(
            tool_turn_payload(conversation_summary="User prefers short replies.")
        )
    )
    assert with_summary.context_strategy.value == "summary_plus_recent"


def test_tool_turn_prepare_injects_user_memories_before_summary() -> None:
    payload = tool_turn_payload(conversation_summary="Earlier summary.")
    payload["user_memories"] = ["用户偏好简洁回答"]
    request = ToolTurnRequest.model_validate(payload)

    prepared = ToolTurnOrchestrator().prepare(request)

    system_contents = [
        message.content for message in prepared.messages if message.role == "system"
    ]
    memories_block = next(
        content
        for content in system_contents
        if isinstance(content, str) and content.startswith("Long-term memories")
    )
    summary_block = next(
        content
        for content in system_contents
        if isinstance(content, str) and content.startswith("Previous conversation summary")
    )
    assert system_contents.index(memories_block) == system_contents.index(summary_block) - 1
    assert "- 用户偏好简洁回答" in memories_block


def test_tool_turn_prepare_omits_memories_block_without_user_memories() -> None:
    prepared = ToolTurnOrchestrator().prepare(
        ToolTurnRequest.model_validate(tool_turn_payload())
    )

    assert not any(
        isinstance(message.content, str) and message.content.startswith("Long-term memories")
        for message in prepared.messages
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
            {"role": "tool", "content": text_parts("done"), "tool_call_id": "missing"}
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
    assert events[0][1]["context_usage"]["strategy"] == "full"
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


def test_tool_turn_stream_reports_summary_plus_recent_strategy() -> None:
    tool_profile = profile(capabilities={ModelCapability.chat, ModelCapability.tool_calling})
    provider = StubProvider(
        tool_profile,
        [],
        tool_stream_outcomes=[
            [
                ProviderStreamChunk(text="已生成图片。"),
                ProviderStreamChunk(finish_reason="stop"),
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
            json=tool_turn_payload(conversation_summary="User prefers short replies."),
        )

    assert response.status_code == 200
    events = parse_sse_events(response.text)
    assert events[0][0] == "started"
    assert events[0][1]["context_usage"]["strategy"] == "summary_plus_recent"


def test_tool_turn_stream_extracts_follow_up_questions() -> None:
    tool_profile = profile(capabilities={ModelCapability.chat, ModelCapability.tool_calling})
    provider = StubProvider(
        tool_profile,
        [],
        tool_stream_outcomes=[
            [
                ProviderStreamChunk(text="已生成图片。"),
                ProviderStreamChunk(
                    text='<follow_up_questions>["换成黑白的？"]</follow_up_questions>',
                ),
                ProviderStreamChunk(finish_reason="stop"),
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
    deltas = [data["text"] for name, data in events if name == "content_delta"]
    assert "".join(deltas) == "已生成图片。"
    assert events[-1][1]["related_questions"] == ["换成黑白的？"]
