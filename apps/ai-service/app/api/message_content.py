from __future__ import annotations

from typing import Any

from app.api.generated.models import ImageContentPart, TextContentPart
from app.llm.types import ChatMessage, MessageContent, ToolCall


def api_message_to_chat_message(message: Any) -> ChatMessage:
    tool_calls = tuple(_to_tool_call(call) for call in getattr(message, "tool_calls", None) or [])
    return ChatMessage(
        role=message.role.value,
        content=message_content_to_internal(message.content),
        tool_calls=tool_calls,
        tool_call_id=getattr(message, "tool_call_id", None),
        name=getattr(message, "name", None),
    )


def message_content_to_internal(content: Any) -> MessageContent:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts: list[dict[str, Any]] = []
    for part in content:
        if isinstance(part, TextContentPart):
            parts.append({"type": "text", "text": part.text})
        elif isinstance(part, ImageContentPart):
            parts.append(
                {"type": "image_url", "image_url": {"url": part.image_url.url}}
            )
        elif isinstance(part, dict):
            parts.append(part)
    return parts


def _to_tool_call(call: Any) -> ToolCall:
    return ToolCall(id=call.id, name=call.name, arguments=call.arguments)
