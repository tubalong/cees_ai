from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from app.core.config import ModelProfile, OutputMode


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class InvocationOptions:
    temperature: float
    max_output_tokens: int
    output_mode: OutputMode
    schema_name: str | None = None
    json_schema: dict[str, Any] | None = None


@dataclass(frozen=True)
class TokenUsageData:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True)
class ProviderResult:
    output: str | dict[str, Any]
    token_usage: TokenUsageData = TokenUsageData()


class LLMProvider(Protocol):
    profile: ModelProfile

    async def invoke(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ProviderResult: ...
