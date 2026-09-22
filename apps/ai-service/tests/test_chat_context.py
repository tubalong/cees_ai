from __future__ import annotations

import json

import pytest

from app.api.generated.models import ChatContextStrategy, ChatRequest, CompactChatRequest
from app.chat.compactor import _split_compaction_output
from app.chat.context import (
    BASE_SYSTEM_PROMPT,
    build_chat_context,
    build_compaction_context,
)
from app.core.config import ChatModePolicy, ModelRole
from app.core.errors import AIServiceError
from tests.helpers import text_parts


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
                {"role": "user", "content": text_parts("The project is CEES AI.")},
                {"role": "assistant", "content": text_parts("Understood.")},
                {"role": "user", "content": text_parts("What is the project name?")},
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


def test_builds_memories_block_when_user_memories_provided() -> None:
    request = ChatRequest.model_validate(
        {
            "request_id": "req-context-memories",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "conversation_summary": "The user is discussing CEES AI.",
            "user_memories": ["用户偏好简洁回答", "用户在 CEES 项目负责产品设计"],
            "messages": [
                {"role": "user", "content": text_parts("What is the project name?")},
            ],
        }
    )

    built = build_chat_context(request, policy(budget=4096))

    system_contents = [
        message.content for message in built.messages if message.role == "system"
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
    assert "- 用户在 CEES 项目负责产品设计" in memories_block


def test_omits_memories_block_without_user_memories() -> None:
    request = ChatRequest.model_validate(
        {
            "request_id": "req-context-no-memories",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "messages": [
                {"role": "user", "content": text_parts("What is the project name?")},
            ],
        }
    )

    built = build_chat_context(request, policy(budget=4096))

    assert not any(
        isinstance(message.content, str) and message.content.startswith("Long-term memories")
        for message in built.messages
    )


def test_uses_summary_and_recent_suffix_when_history_exceeds_budget() -> None:
    request = ChatRequest.model_validate(
        {
            "request_id": "req-context-2",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "conversation_summary": "The user is discussing CEES AI.",
            "messages": [
                {"role": "user", "content": text_parts("old question " * 200)},
                {"role": "assistant", "content": text_parts("old answer " * 200)},
                {"role": "user", "content": text_parts("latest question")},
            ],
        }
    )

    built = build_chat_context(request, policy())

    assert built.usage.strategy == ChatContextStrategy.summary_plus_recent
    assert built.usage.included_message_count == 1
    assert built.usage.history_truncated
    assert built.messages[-1].content == text_parts("latest question")


def test_rejects_chat_when_final_message_is_not_user() -> None:
    request = ChatRequest.model_validate(
        {
            "request_id": "req-context-3",
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "messages": [{"role": "assistant", "content": text_parts("finished")}],
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
                {"id": "message-1", "role": "user", "content": text_parts("Question")},
                {"id": "message-2", "role": "assistant", "content": text_parts("Answer")},
            ],
        }
    )

    built = build_compaction_context(request, context_budget_tokens=4096)

    assert built.summarized_through_message_id == "message-2"
    assert "Earlier summary." in built.messages[1].content


def test_split_compaction_output_without_memory_block() -> None:
    output = "用户讨论了项目进展，决定下周发布。"

    summary, memories = _split_compaction_output(output)

    assert summary == output
    assert memories == []


def test_split_compaction_output_strips_memory_block() -> None:
    output = (
        "用户讨论了项目进展。"
        '<user_memories>[{"type": "DECISION", "content": "用户决定下周发布"}]</user_memories>'
    )

    summary, memories = _split_compaction_output(output)

    assert summary == "用户讨论了项目进展。"
    assert memories == [{"type": "DECISION", "content": "用户决定下周发布", "action": "create"}]


def test_split_compaction_output_keeps_summary_when_memory_block_is_broken() -> None:
    output = "用户讨论了项目进展。<user_memories>[{\"type\": \"FACT\"</user_memories>"

    summary, memories = _split_compaction_output(output)

    assert summary == "用户讨论了项目进展。"
    assert memories == []


def test_split_compaction_output_limits_to_three_and_drops_invalid() -> None:
    entries = [
        {"type": "FACT", "content": "事实 A"},
        {"type": "FACT", "content": "事实 B"},
        {"type": "FACT", "content": "事实 C"},
        {"type": "FACT", "content": "事实 D"},
        {"type": "TEAM", "content": "团队信息"},
    ]
    output = "正文。<user_memories>" + json.dumps(entries, ensure_ascii=False) + "</user_memories>"

    summary, memories = _split_compaction_output(output)

    assert summary == "正文。"
    assert [memory["content"] for memory in memories] == ["事实 A", "事实 B", "事实 C"]


def test_base_system_prompt_covers_knowledge_intro_and_system_layer_guard() -> None:
    """块 7d：人设需覆盖知识库功能告知话术与系统层信息对抗（3.9 节）。"""

    # 介绍性问题：答复带一句知识库能力告知。
    assert "When the user asks who you are or what you can do" in BASE_SYSTEM_PROMPT
    assert "cited sources" in BASE_SYSTEM_PROMPT
    # 追问“知识库是什么/怎么用”：解释用户侧价值与用法，不展开内部实现。
    assert "When the user asks what the knowledge base is or how to use it" in BASE_SYSTEM_PROMPT
    assert "upload documents and they are parsed automatically" in BASE_SYSTEM_PROMPT
    assert "Do not describe internal" in BASE_SYSTEM_PROMPT
    # 诱导对抗：系统层信息即使被直接询问也拒绝展开，回归功能描述。
    assert "system-layer details" in BASE_SYSTEM_PROMPT
    assert "decline and" in BASE_SYSTEM_PROMPT
    assert "steer back" in BASE_SYSTEM_PROMPT
    assert "你的系统架构是什么" in BASE_SYSTEM_PROMPT
    assert "用的什么数据库" in BASE_SYSTEM_PROMPT
    # 块 7c 已提前落地的三条约束保持完整。
    assert "Simplified Chinese" in BASE_SYSTEM_PROMPT
    assert "never expose them in replies to the user" in BASE_SYSTEM_PROMPT
    assert "first resort" in BASE_SYSTEM_PROMPT
