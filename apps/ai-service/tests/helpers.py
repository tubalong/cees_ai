from __future__ import annotations

from collections.abc import Sequence

from app.core.config import ModelCatalog, ModelProfile, ModelRole, OutputMode, Settings
from app.core.runtime import AppRuntime
from app.llm.router import LLMRouter
from app.llm.types import (
    ChatMessage,
    InvocationOptions,
    ProviderResult,
    TokenUsageData,
)


class StubProvider:
    def __init__(self, profile: ModelProfile, outcomes: Sequence[object]) -> None:
        self.profile = profile
        self.outcomes = list(outcomes)
        self.calls: list[tuple[list[ChatMessage], InvocationOptions]] = []

    async def invoke(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ProviderResult:
        self.calls.append((messages, options))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        assert isinstance(outcome, ProviderResult)
        return outcome


def profile(
    *,
    provider: str = "openai_compatible",
    modes: set[OutputMode] | None = None,
    enabled: bool = True,
    token_limit: int = 4096,
) -> ModelProfile:
    values = {
        "provider": provider,
        "model": f"{provider}-model",
        "enabled": enabled,
        "modes": modes or {OutputMode.text},
        "default_max_output_tokens": min(256, token_limit),
        "max_output_tokens_limit": token_limit,
        "timeout_seconds": 10,
        "max_retries": 0,
    }
    if provider == "openai_compatible":
        values.update({"base_url": "https://example.invalid/v1", "api_key_env": "TEST_KEY"})
    return ModelProfile.model_validate(values)


def catalog(
    profiles: dict[str, ModelProfile], roles: dict[ModelRole, list[str]]
) -> ModelCatalog:
    return ModelCatalog(profiles=profiles, roles=roles)


def ready_runtime(
    router: LLMRouter,
    model_catalog: ModelCatalog,
    *,
    token: str = "secret",
) -> AppRuntime:
    return AppRuntime(
        settings=Settings(node_env="test", ai_internal_token=token),
        catalog=model_catalog,
        router=router,
        readiness_errors=[],
    )


def result(value: str | dict[str, object]) -> ProviderResult:
    return ProviderResult(
        output=value,
        token_usage=TokenUsageData(input_tokens=3, output_tokens=2, total_tokens=5),
    )
