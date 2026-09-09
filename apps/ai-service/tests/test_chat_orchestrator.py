from __future__ import annotations

import pytest

from app.api.generated.models import ChatRequest, CompactChatRequest
from app.chat.compactor import ChatCompactor
from app.chat.orchestrator import ChatOrchestrator
from app.core.config import ModelRole
from app.core.errors import AIServiceError
from app.llm.router import LLMRouter
from tests.helpers import StubProvider, catalog, chat_config, profile, result


def chat_request(*, mode: str = "standard", max_output_tokens: int | None = None) -> ChatRequest:
    return ChatRequest.model_validate(
        {
            "request_id": f"req-{mode}",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "mode": mode,
            "messages": [{"role": "user", "content": "hello"}],
            "max_output_tokens": max_output_tokens,
        }
    )


@pytest.mark.asyncio
async def test_standard_chat_uses_default_role_without_reasoning() -> None:
    model_profile = profile()
    provider = StubProvider(model_profile, [result("standard response")])
    model_catalog = catalog(
        {"primary": model_profile},
        {
            ModelRole.default: ["primary"],
            ModelRole.reasoning: ["primary"],
        },
        chat=chat_config(),
    )
    orchestrator = ChatOrchestrator(LLMRouter(model_catalog, lambda _name, _profile: provider))

    invocation = await orchestrator.invoke(chat_request())

    assert invocation.routing.provider_result.output == "standard response"
    assert provider.calls[0][1].reasoning_effort is None
    assert provider.calls[0][1].max_output_tokens == 256


@pytest.mark.asyncio
async def test_ultra_chat_enables_configured_reasoning_effort() -> None:
    model_profile = profile()
    provider = StubProvider(model_profile, [result("ultra response")])
    model_catalog = catalog(
        {"primary": model_profile},
        {
            ModelRole.default: ["primary"],
            ModelRole.reasoning: ["primary"],
        },
        chat=chat_config(),
    )
    orchestrator = ChatOrchestrator(LLMRouter(model_catalog, lambda _name, _profile: provider))

    invocation = await orchestrator.invoke(chat_request(mode="ultra"))

    assert invocation.routing.provider_result.output == "ultra response"
    assert provider.calls[0][1].reasoning_effort == "high"
    assert provider.calls[0][1].max_output_tokens == 512


def test_chat_rejects_mode_token_limit_override() -> None:
    model_profile = profile()
    provider = StubProvider(model_profile, [result("unused")])
    model_catalog = catalog(
        {"primary": model_profile},
        {
            ModelRole.default: ["primary"],
            ModelRole.reasoning: ["primary"],
        },
        chat=chat_config(),
    )
    orchestrator = ChatOrchestrator(LLMRouter(model_catalog, lambda _name, _profile: provider))

    with pytest.raises(AIServiceError) as raised:
        orchestrator.prepare(chat_request(max_output_tokens=1025))

    assert raised.value.code == "INVALID_CHAT_REQUEST"
    assert not provider.calls


@pytest.mark.asyncio
async def test_compactor_returns_trimmed_summary_and_last_message_id() -> None:
    model_profile = profile()
    provider = StubProvider(model_profile, [result("  Durable summary.  ")])
    model_catalog = catalog(
        {"primary": model_profile},
        {
            ModelRole.default: ["primary"],
            ModelRole.reasoning: ["primary"],
        },
        chat=chat_config(),
    )
    compactor = ChatCompactor(LLMRouter(model_catalog, lambda _name, _profile: provider))
    request = CompactChatRequest.model_validate(
        {
            "request_id": "req-compact",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "messages": [
                {"id": "message-1", "role": "user", "content": "Question"},
                {"id": "message-2", "role": "assistant", "content": "Answer"},
            ],
        }
    )

    compaction = await compactor.compact(request)

    assert compaction.summary == "Durable summary."
    assert compaction.summarized_through_message_id == "message-2"
    assert provider.calls[0][1].max_output_tokens == 512


def test_chat_defaults_to_standard_mode_when_omitted() -> None:
    model_profile = profile()
    model_catalog = catalog(
        {"primary": model_profile},
        {
            ModelRole.default: ["primary"],
            ModelRole.reasoning: ["primary"],
        },
        chat=chat_config(),
    )
    orchestrator = ChatOrchestrator(LLMRouter(model_catalog))
    request = ChatRequest.model_validate(
        {
            "request_id": "req-default-mode",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "messages": [{"role": "user", "content": "hello"}],
        }
    )

    prepared = orchestrator.prepare(request)

    assert prepared.mode.value == "standard"
