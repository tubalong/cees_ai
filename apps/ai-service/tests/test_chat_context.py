from __future__ import annotations

import pytest

from app.api.generated.models import ChatContextStrategy, ChatRequest, CompactChatRequest
from app.chat.context import build_chat_context, build_compaction_context
from app.core.config import ChatModePolicy, ModelRole
from app.core.errors import AIServiceError


def policy(*, budget: int = 1024) -> ChatModePolicy:
    return ChatModePolicy(
        role=ModelRole.default,
        default_max_output_tokens=256,
        max_output_tokens_limit=1024,
        context_budget_tokens=budget,
    )


def test_builds_full_context_with_instructions_and_history() -> None:
    request = ChatRequest.model_validate(
        {
            "request_id": "req-context-1",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "instructions": "Answer concisely.",
            "messages": [
                {"role": "user", "content": "The project is CEES AI."},
                {"role": "assistant", "content": "Understood."},
                {"role": "user", "content": "What is the project name?"},
            ],
        }
    )

    built = build_chat_context(request, policy(budget=4096))

    assert built.usage.strategy == ChatContextStrategy.full
    assert built.usage.received_message_count == 3
    assert built.usage.included_message_count == 3
    assert not built.usage.history_truncated
    assert [message.role for message in built.messages[-3:]] == [
        "user",
        "assistant",
        "user",
    ]
    assert built.messages[1].content == "Answer concisely."


def test_uses_summary_and_recent_suffix_when_history_exceeds_budget() -> None:
    request = ChatRequest.model_validate(
        {
            "request_id": "req-context-2",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "conversation_summary": "The user is discussing CEES AI.",
            "messages": [
                {"role": "user", "content": "old question " * 200},
                {"role": "assistant", "content": "old answer " * 200},
                {"role": "user", "content": "latest question"},
            ],
        }
    )

    built = build_chat_context(request, policy())

    assert built.usage.strategy == ChatContextStrategy.summary_plus_recent
    assert built.usage.included_message_count == 1
    assert built.usage.history_truncated
    assert built.messages[-1].content == "latest question"


def test_rejects_chat_when_final_message_is_not_user() -> None:
    request = ChatRequest.model_validate(
        {
            "request_id": "req-context-3",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "messages": [{"role": "assistant", "content": "finished"}],
        }
    )

    with pytest.raises(AIServiceError) as raised:
        build_chat_context(request, policy())

    assert raised.value.code == "INVALID_CHAT_REQUEST"


def test_compaction_preserves_last_message_identifier() -> None:
    request = CompactChatRequest.model_validate(
        {
            "request_id": "req-compact-1",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "previous_summary": "Earlier summary.",
            "messages": [
                {"id": "message-1", "role": "user", "content": "Question"},
                {"id": "message-2", "role": "assistant", "content": "Answer"},
            ],
        }
    )

    built = build_compaction_context(request, context_budget_tokens=4096)

    assert built.summarized_through_message_id == "message-2"
    assert "Earlier summary." in built.messages[1].content
