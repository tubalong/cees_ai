from __future__ import annotations

from collections.abc import AsyncIterator, Sequence

from app.core.config import (
    ChatConfig,
    ChatMode,
    ChatModePolicy,
    ModelCapability,
    ModelCatalog,
    ModelProfile,
    ModelRole,
    OutputMode,
    Settings,
)
from app.core.runtime import AppRuntime
from app.llm.router import LLMRouter
from app.llm.types import (
    ChatMessage,
    InvocationOptions,
    ProviderResult,
    ProviderStreamChunk,
    TokenUsageData,
    ToolCallingResult,
)


class StubProvider:
    def __init__(
        self,
        profile: ModelProfile,
        outcomes: Sequence[object],
        *,
        stream_outcomes: Sequence[Sequence[object]] = (),
        tool_outcomes: Sequence[object] = (),
        tool_stream_outcomes: Sequence[Sequence[object]] = (),
    ) -> None:
        self.profile = profile
        self.outcomes = list(outcomes)
        self.calls: list[tuple[list[ChatMessage], InvocationOptions]] = []
        self.stream_outcomes = [list(items) for items in stream_outcomes]
        self.stream_calls: list[tuple[list[ChatMessage], InvocationOptions]] = []
        self.tool_outcomes = list(tool_outcomes)
        self.tool_calls: list[tuple[list[ChatMessage], InvocationOptions]] = []
        self.tool_stream_outcomes = [list(items) for items in tool_stream_outcomes]
        self.tool_stream_calls: list[tuple[list[ChatMessage], InvocationOptions]] = []

    async def invoke(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ProviderResult:
        self.calls.append((messages, options))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        assert isinstance(outcome, ProviderResult)
        return outcome

    async def stream(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]:
        self.stream_calls.append((messages, options))
        for outcome in self.stream_outcomes.pop(0):
            if isinstance(outcome, Exception):
                raise outcome
            assert isinstance(outcome, ProviderStreamChunk)
            yield outcome

    async def invoke_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ToolCallingResult:
        self.tool_calls.append((messages, options))
        outcome = self.tool_outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        assert isinstance(outcome, ToolCallingResult)
        return outcome

    async def stream_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]:
        self.tool_stream_calls.append((messages, options))
        for outcome in self.tool_stream_outcomes.pop(0):
            if isinstance(outcome, Exception):
                raise outcome
            assert isinstance(outcome, ProviderStreamChunk)
            yield outcome


def profile(
    *,
    provider: str = "openai_compatible",
    modes: set[OutputMode] | None = None,
    enabled: bool = True,
    token_limit: int = 4096,
    capabilities: set[ModelCapability] | None = None,
) -> ModelProfile:
    values = {
        "provider": provider,
        "model": f"{provider}-model",
        "enabled": enabled,
        "modes": modes or {OutputMode.text},
        "capabilities": capabilities or {ModelCapability.chat},
        "default_max_output_tokens": min(256, token_limit),
        "max_output_tokens_limit": token_limit,
        "timeout_seconds": 10,
        "max_retries": 0,
    }
    if provider != "mock":
        values.update({"base_url": "https://example.invalid/v1", "api_key_env": "TEST_KEY"})
    return ModelProfile.model_validate(values)


def chat_config() -> ChatConfig:
    return ChatConfig(
        modes={
            ChatMode.standard: ChatModePolicy(
                role=ModelRole.default,
                default_max_output_tokens=256,
                max_output_tokens_limit=1024,
                context_budget_tokens=4096,
                emit_reasoning_status=False,
            ),
            ChatMode.ultra: ChatModePolicy(
                role=ModelRole.reasoning,
                reasoning_effort="high",
                default_max_output_tokens=512,
                max_output_tokens_limit=2048,
                context_budget_tokens=8192,
                emit_reasoning_status=True,
            ),
        },
        compaction_role=ModelRole.default,
        compaction_max_output_tokens=512,
        compaction_context_budget_tokens=8192,
    )


def catalog(
    profiles: dict[str, ModelProfile],
    roles: dict[ModelRole, list[str]],
    *,
    chat: ChatConfig | None = None,
) -> ModelCatalog:
    return ModelCatalog(profiles=profiles, roles=roles, chat=chat)


def ready_runtime(
    router: LLMRouter,
    model_catalog: ModelCatalog,
    *,
    token: str = "secret",
    settings: Settings | None = None,
) -> AppRuntime:
    return AppRuntime(
        settings=settings or Settings(node_env="test", ai_internal_token=token),
        catalog=model_catalog,
        router=router,
        readiness_errors=[],
    )


def result(value: str | dict[str, object], finish_reason: str | None = "stop") -> ProviderResult:
    return ProviderResult(
        output=value,
        token_usage=TokenUsageData(input_tokens=3, output_tokens=2, total_tokens=5),
        finish_reason=finish_reason,
    )
