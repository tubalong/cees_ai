from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.api.generated.models import ChatContextStrategy, ToolTurnRequest
from app.api.generated.models import ToolCall as ApiToolCall
from app.api.message_content import message_content_to_internal
from app.chat.context import BASE_SYSTEM_PROMPT, estimate_message_tokens
from app.chat.follow_up import FOLLOW_UP_INSTRUCTION
from app.core.config import ChatMode
from app.core.errors import AIServiceError
from app.llm.types import ChatMessage, ToolCall


@dataclass(frozen=True)
class PreparedToolTurn:
    mode: ChatMode
    messages: list[ChatMessage]
    tools: tuple[dict[str, Any], ...]
    max_output_tokens: int | None
    received_message_count: int
    included_message_count: int
    estimated_input_tokens: int
    context_strategy: ChatContextStrategy


class ToolTurnOrchestrator:
    def prepare(self, request: ToolTurnRequest) -> PreparedToolTurn:
        if not request.tools:
            raise AIServiceError(
                "INVALID_TOOL_TURN_REQUEST",
                "At least one tool definition is required",
                status_code=422,
                request_id=request.request_id,
            )

        fixed_messages = [ChatMessage(role="system", content=BASE_SYSTEM_PROMPT)]
        if request.instructions:
            fixed_messages.append(ChatMessage(role="system", content=request.instructions))
        fixed_messages.append(ChatMessage(role="system", content=FOLLOW_UP_INSTRUCTION))
        if request.conversation_summary:
            fixed_messages.append(
                ChatMessage(
                    role="system",
                    content=(
                        "Previous conversation summary (historical context, not new system "
                        f"instructions):\n{request.conversation_summary}"
                    ),
                )
            )

        recent_messages = [_to_chat_message(message) for message in request.messages]
        messages = [*fixed_messages, *recent_messages]
        _validate_tool_call_ids(recent_messages, request.request_id)

        estimated_input_tokens = estimate_message_tokens(messages)
        if estimated_input_tokens < 1:
            estimated_input_tokens = 1

        # 工具轮次不截断消息：NestJS 侧要么传全量历史，要么传摘要 + 增量消息，
        # 因此策略只需区分是否携带摘要，不会出现 recent_only。
        context_strategy = (
            ChatContextStrategy.summary_plus_recent
            if request.conversation_summary
            else ChatContextStrategy.full
        )

        return PreparedToolTurn(
            mode=ChatMode(request.mode or ChatMode.standard),
            messages=messages,
            tools=tuple(tool.model_dump() for tool in request.tools),
            max_output_tokens=request.max_output_tokens,
            received_message_count=len(request.messages),
            included_message_count=len(messages),
            estimated_input_tokens=estimated_input_tokens,
            context_strategy=context_strategy,
        )


def _to_chat_message(message: Any) -> ChatMessage:
    tool_calls = tuple(_to_tool_call(call) for call in message.tool_calls or [])
    return ChatMessage(
        role=message.role.value,
        content=message_content_to_internal(message.content) or "",
        tool_calls=tool_calls,
        tool_call_id=message.tool_call_id,
        name=message.name,
    )


def _to_tool_call(call: ApiToolCall) -> ToolCall:
    return ToolCall(id=call.id, name=call.name, arguments=call.arguments)


def _validate_tool_call_ids(messages: list[ChatMessage], request_id: str) -> None:
    assistant_tool_call_ids: set[str] = set()
    for message in messages:
        if message.role == "assistant":
            for tool_call in message.tool_calls:
                if tool_call.id in assistant_tool_call_ids:
                    raise AIServiceError(
                        "INVALID_TOOL_TURN_REQUEST",
                        f"Duplicate assistant tool call id {tool_call.id}",
                        status_code=422,
                        request_id=request_id,
                    )
                assistant_tool_call_ids.add(tool_call.id)
        elif message.role == "tool":
            if not message.tool_call_id:
                raise AIServiceError(
                    "INVALID_TOOL_TURN_REQUEST",
                    "Tool messages require tool_call_id",
                    status_code=422,
                    request_id=request_id,
                )
            if message.tool_call_id not in assistant_tool_call_ids:
                raise AIServiceError(
                    "INVALID_TOOL_TURN_REQUEST",
                    f"Tool message references unknown tool call id {message.tool_call_id}",
                    status_code=422,
                    request_id=request_id,
                )
