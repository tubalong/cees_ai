from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from app.core.config import ModelProfile, OutputMode

ReasoningEffort = Literal["low", "high", "max"]
MessageContent = str | list[dict[str, Any]]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant", "tool"]
    content: MessageContent
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str | None = None
    name: str | None = None


@dataclass(frozen=True)
class InvocationOptions:
    temperature: float
    max_output_tokens: int
    output_mode: OutputMode
    schema_name: str | None = None
    json_schema: dict[str, Any] | None = None
    reasoning_effort: ReasoningEffort | None = None
    tools: tuple[dict[str, Any], ...] | None = None


@dataclass(frozen=True)
class TokenUsageData:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True)
class ProviderResult:
    output: str | dict[str, Any]
    token_usage: TokenUsageData = TokenUsageData()
    finish_reason: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()


@dataclass(frozen=True)
class ProviderStreamChunk:
    text: str = ""
    token_usage: TokenUsageData | None = None
    finish_reason: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()


@dataclass(frozen=True)
class ToolCallingResult:
    content: str
    tool_calls: tuple[ToolCall, ...]
    token_usage: TokenUsageData = TokenUsageData()
    finish_reason: str | None = None


def content_to_text(content: MessageContent) -> str:
    if isinstance(content, str):
        return content
    return "".join(
        part.get("text", "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


def content_has_image(content: MessageContent) -> bool:
    if isinstance(content, str):
        return False
    return any(
        isinstance(part, dict) and part.get("type") == "image_url" for part in content
    )


def content_size_bytes(content: MessageContent) -> int:
    if isinstance(content, str):
        return len(content.encode("utf-8"))
    total = 0
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            total += len(str(part.get("text", "")).encode("utf-8"))
        elif part.get("type") == "image_url":
            image_url = part.get("image_url")
            if isinstance(image_url, dict):
                total += len(str(image_url.get("url", "")).encode("utf-8"))
    return total


class LLMProvider(Protocol):
    profile: ModelProfile

    async def invoke(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ProviderResult: ...

    def stream(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]: ...

    async def invoke_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ToolCallingResult: ...

    def stream_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]: ...
