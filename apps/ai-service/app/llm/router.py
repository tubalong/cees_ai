from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError

from app.core.config import ModelCapability, ModelCatalog, ModelProfile, ModelRole, OutputMode
from app.core.errors import (
    AIServiceError,
    ProviderOutputError,
    ProviderPermanentError,
    ProviderTransientError,
)
from app.llm.providers import create_provider
from app.llm.types import (
    ChatMessage,
    InvocationOptions,
    LLMProvider,
    ProviderResult,
    ProviderStreamChunk,
    ReasoningEffort,
    ToolCallingResult,
)

logger = logging.getLogger(__name__)
ProviderBuilder = Callable[[str, ModelProfile], LLMProvider]


@dataclass(frozen=True)
class RoutingResult:
    profile_name: str
    profile: ModelProfile
    provider_result: ProviderResult
    fallback_count: int
    latency_ms: int


@dataclass(frozen=True)
class ToolCallingRoutingResult:
    profile_name: str
    profile: ModelProfile
    tool_result: ToolCallingResult
    fallback_count: int
    latency_ms: int


@dataclass(frozen=True)
class StreamingRoutingResult:
    profile_name: str
    profile: ModelProfile
    chunks: AsyncIterator[ProviderStreamChunk]
    fallback_count: int
    started_at: float


class LLMRouter:
    def __init__(
        self,
        catalog: ModelCatalog,
        provider_builder: ProviderBuilder | None = None,
    ) -> None:
        self.catalog = catalog
        self._providers: dict[str, LLMProvider] = {}
        self._provider_builder = provider_builder or self._build_provider

    async def invoke(
        self,
        *,
        request_id: str,
        tenant_id: str,
        user_id: str,
        messages: list[ChatMessage],
        output_mode: OutputMode,
        role: ModelRole,
        profile_override: str | None,
        temperature: float | None,
        max_output_tokens: int | None,
        reasoning_effort: ReasoningEffort | None = None,
        schema_name: str | None = None,
        json_schema: dict[str, Any] | None = None,
    ) -> RoutingResult:
        if output_mode == OutputMode.json_schema:
            _validate_json_schema(json_schema, request_id)

        candidates = self._resolve_candidates(role, profile_override, output_mode, request_id)
        started = time.perf_counter()
        last_transient_error: ProviderTransientError | None = None

        for index, profile_name in enumerate(candidates):
            profile = self.catalog.profiles[profile_name]
            options = self._build_options(
                profile_name=profile_name,
                profile=profile,
                output_mode=output_mode,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                request_id=request_id,
                reasoning_effort=reasoning_effort,
                schema_name=schema_name,
                json_schema=json_schema,
            )
            provider = self._get_provider(profile_name, profile)
            try:
                result = await provider.invoke(messages, options)
                if output_mode == OutputMode.json_schema:
                    assert json_schema is not None
                    try:
                        Draft202012Validator(json_schema).validate(result.output)
                    except ValidationError as exc:
                        raise ProviderOutputError(
                            "structured output failed JSON Schema validation"
                        ) from exc
                latency_ms = round((time.perf_counter() - started) * 1000)
                logger.info(
                    "llm invocation completed",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "role": role.value,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "fallback_count": index,
                        "latency_ms": latency_ms,
                        "input_tokens": result.token_usage.input_tokens,
                        "output_tokens": result.token_usage.output_tokens,
                        "total_tokens": result.token_usage.total_tokens,
                    },
                )
                return RoutingResult(profile_name, profile, result, index, latency_ms)
            except ProviderTransientError as exc:
                last_transient_error = exc
                logger.warning(
                    "llm provider transient failure",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "role": role.value,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "attempt": index + 1,
                        "error_category": type(exc).__name__,
                    },
                )
                if profile_override is not None:
                    break
            except ProviderOutputError as exc:
                raise AIServiceError(
                    "LLM_OUTPUT_INVALID",
                    "The provider output did not match the requested format",
                    status_code=502,
                    request_id=request_id,
                ) from exc
            except ProviderPermanentError as exc:
                raise AIServiceError(
                    "LLM_UNAVAILABLE",
                    "The selected provider rejected the invocation",
                    status_code=503,
                    request_id=request_id,
                ) from exc

        raise AIServiceError(
            "LLM_UNAVAILABLE",
            "No configured LLM profile completed the invocation",
            status_code=503,
            retryable=True,
            request_id=request_id,
        ) from last_transient_error

    async def start_stream(
        self,
        *,
        request_id: str,
        tenant_id: str,
        user_id: str,
        messages: list[ChatMessage],
        role: ModelRole,
        profile_override: str | None,
        temperature: float | None,
        max_output_tokens: int | None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> StreamingRoutingResult:
        candidates = self._resolve_candidates(role, profile_override, OutputMode.text, request_id)
        started_at = time.perf_counter()
        last_transient_error: ProviderTransientError | None = None

        for index, profile_name in enumerate(candidates):
            profile = self.catalog.profiles[profile_name]
            options = self._build_options(
                profile_name=profile_name,
                profile=profile,
                output_mode=OutputMode.text,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                request_id=request_id,
                reasoning_effort=reasoning_effort,
            )
            provider = self._get_provider(profile_name, profile)
            chunks = provider.stream(messages, options).__aiter__()
            try:
                first_chunk = await anext(chunks, None)
                logger.info(
                    "llm stream started",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "role": role.value,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "fallback_count": index,
                    },
                )
                return StreamingRoutingResult(
                    profile_name=profile_name,
                    profile=profile,
                    chunks=_prepend_chunk(first_chunk, chunks),
                    fallback_count=index,
                    started_at=started_at,
                )
            except ProviderTransientError as exc:
                last_transient_error = exc
                logger.warning(
                    "llm provider failed before streaming started",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "role": role.value,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "attempt": index + 1,
                        "error_category": type(exc).__name__,
                    },
                )
                if profile_override is not None:
                    break
            except ProviderPermanentError as exc:
                raise AIServiceError(
                    "LLM_UNAVAILABLE",
                    "The selected provider rejected the streaming invocation",
                    status_code=503,
                    request_id=request_id,
                ) from exc

        raise AIServiceError(
            "LLM_UNAVAILABLE",
            "No configured LLM profile started the invocation stream",
            status_code=503,
            retryable=True,
            request_id=request_id,
        ) from last_transient_error

    async def invoke_with_tools(
        self,
        *,
        request_id: str,
        tenant_id: str,
        user_id: str,
        messages: list[ChatMessage],
        tools: tuple[dict[str, Any], ...],
        profile_override: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
    ) -> ToolCallingRoutingResult:
        if not tools:
            raise AIServiceError(
                "INVALID_TOOL_CALLING_REQUEST",
                "At least one tool definition is required",
                status_code=422,
                request_id=request_id,
            )

        candidates = self._resolve_candidates(
            ModelRole.orchestrator, profile_override, OutputMode.text, request_id
        )
        started = time.perf_counter()
        last_transient_error: ProviderTransientError | None = None

        for index, profile_name in enumerate(candidates):
            profile = self.catalog.profiles[profile_name]
            options = self._build_options(
                profile_name=profile_name,
                profile=profile,
                output_mode=OutputMode.text,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                request_id=request_id,
                tools=tools,
            )
            provider = self._get_provider(profile_name, profile)
            try:
                result = await provider.invoke_with_tools(messages, options)
                latency_ms = round((time.perf_counter() - started) * 1000)
                logger.info(
                    "llm tool invocation completed",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "fallback_count": index,
                        "latency_ms": latency_ms,
                        "tool_call_count": len(result.tool_calls),
                        "input_tokens": result.token_usage.input_tokens,
                        "output_tokens": result.token_usage.output_tokens,
                        "total_tokens": result.token_usage.total_tokens,
                    },
                )
                return ToolCallingRoutingResult(
                    profile_name, profile, result, index, latency_ms
                )
            except ProviderTransientError as exc:
                last_transient_error = exc
                logger.warning(
                    "llm tool invocation transient failure",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "attempt": index + 1,
                        "error_category": type(exc).__name__,
                    },
                )
                if profile_override is not None:
                    break
            except ProviderOutputError as exc:
                raise AIServiceError(
                    "LLM_OUTPUT_INVALID",
                    "The provider returned invalid tool call output",
                    status_code=502,
                    request_id=request_id,
                ) from exc
            except ProviderPermanentError as exc:
                raise AIServiceError(
                    "LLM_UNAVAILABLE",
                    "The selected provider rejected the tool invocation",
                    status_code=503,
                    request_id=request_id,
                ) from exc

        raise AIServiceError(
            "LLM_UNAVAILABLE",
            "No configured LLM profile completed the tool invocation",
            status_code=503,
            retryable=True,
            request_id=request_id,
        ) from last_transient_error

    async def start_tool_stream(
        self,
        *,
        request_id: str,
        tenant_id: str,
        user_id: str,
        messages: list[ChatMessage],
        tools: tuple[dict[str, Any], ...],
        profile_override: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
    ) -> StreamingRoutingResult:
        if not tools:
            raise AIServiceError(
                "INVALID_TOOL_CALLING_REQUEST",
                "At least one tool definition is required",
                status_code=422,
                request_id=request_id,
            )

        candidates = self._resolve_candidates(
            ModelRole.orchestrator, profile_override, OutputMode.text, request_id
        )
        started_at = time.perf_counter()
        last_transient_error: ProviderTransientError | None = None

        for index, profile_name in enumerate(candidates):
            profile = self.catalog.profiles[profile_name]
            options = self._build_options(
                profile_name=profile_name,
                profile=profile,
                output_mode=OutputMode.text,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                request_id=request_id,
                tools=tools,
            )
            provider = self._get_provider(profile_name, profile)
            chunks = provider.stream_with_tools(messages, options).__aiter__()
            try:
                first_chunk = await anext(chunks, None)
                logger.info(
                    "llm tool stream started",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "fallback_count": index,
                    },
                )
                return StreamingRoutingResult(
                    profile_name=profile_name,
                    profile=profile,
                    chunks=_prepend_chunk(first_chunk, chunks),
                    fallback_count=index,
                    started_at=started_at,
                )
            except ProviderTransientError as exc:
                last_transient_error = exc
                logger.warning(
                    "llm tool stream transient failure",
                    extra={
                        "request_id": request_id,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "attempt": index + 1,
                        "error_category": type(exc).__name__,
                    },
                )
                if profile_override is not None:
                    break
            except ProviderPermanentError as exc:
                raise AIServiceError(
                    "LLM_UNAVAILABLE",
                    "The selected provider rejected the tool streaming invocation",
                    status_code=503,
                    request_id=request_id,
                ) from exc

        raise AIServiceError(
            "LLM_UNAVAILABLE",
            "No configured LLM profile started the tool invocation stream",
            status_code=503,
            retryable=True,
            request_id=request_id,
        ) from last_transient_error

    def get_langchain_model(self, profile_name: str) -> Any:
        profile = self.catalog.profiles.get(profile_name)
        if profile is None or not profile.enabled:
            raise KeyError(profile_name)
        provider = self._get_provider(profile_name, profile)
        model = getattr(provider, "chat_model", None)
        if model is None:
            raise TypeError(f"profile {profile_name} does not expose a LangChain chat model")
        return model

    def _resolve_candidates(
        self,
        role: ModelRole,
        profile_override: str | None,
        output_mode: OutputMode,
        request_id: str,
    ) -> list[str]:
        configured = self.catalog.roles.get(role, [])
        if profile_override is not None:
            if profile_override not in configured:
                raise AIServiceError(
                    "UNKNOWN_OR_UNALLOWED_LLM_PROFILE",
                    "The requested LLM profile is not allowed for this role",
                    status_code=400,
                    request_id=request_id,
                )
            candidates = [profile_override]
        else:
            candidates = configured
        if not candidates:
            raise AIServiceError(
                "UNSUPPORTED_OUTPUT_MODE",
                f"No profiles are configured for role {role.value}",
                status_code=400,
                request_id=request_id,
            )
        for profile_name in candidates:
            profile = self.catalog.profiles.get(profile_name)
            if profile is None or not profile.enabled:
                raise AIServiceError(
                    "AI_SERVICE_NOT_READY",
                    "A configured LLM profile is unavailable",
                    status_code=503,
                    retryable=True,
                    request_id=request_id,
                )
            if output_mode not in profile.modes:
                raise AIServiceError(
                    "UNSUPPORTED_OUTPUT_MODE",
                    f"Profile {profile_name} does not support {output_mode.value}",
                    status_code=400,
                    request_id=request_id,
                )
            if (
                role == ModelRole.orchestrator
                and ModelCapability.tool_calling not in profile.capabilities
            ):
                raise AIServiceError(
                    "UNSUPPORTED_TOOL_CALLING",
                    f"Profile {profile_name} does not support tool_calling",
                    status_code=400,
                    request_id=request_id,
                )
        return candidates

    def _get_provider(self, profile_name: str, profile: ModelProfile) -> LLMProvider:
        provider = self._providers.get(profile_name)
        if provider is None:
            provider = self._provider_builder(profile_name, profile)
            self._providers[profile_name] = provider
        return provider

    @staticmethod
    def _build_options(
        *,
        profile_name: str,
        profile: ModelProfile,
        output_mode: OutputMode,
        temperature: float | None,
        max_output_tokens: int | None,
        request_id: str,
        reasoning_effort: ReasoningEffort | None = None,
        schema_name: str | None = None,
        json_schema: dict[str, Any] | None = None,
        tools: tuple[dict[str, Any], ...] | None = None,
    ) -> InvocationOptions:
        effective_max_tokens = max_output_tokens or profile.default_max_output_tokens
        if effective_max_tokens > profile.max_output_tokens_limit:
            raise AIServiceError(
                "INVALID_INVOCATION_REQUEST",
                f"max_output_tokens exceeds the limit for profile {profile_name}",
                status_code=422,
                request_id=request_id,
            )
        return InvocationOptions(
            temperature=profile.temperature if temperature is None else temperature,
            max_output_tokens=effective_max_tokens,
            output_mode=output_mode,
            schema_name=schema_name,
            json_schema=json_schema,
            reasoning_effort=reasoning_effort,
            tools=tools,
        )

    @staticmethod
    def _build_provider(profile_name: str, profile: ModelProfile) -> LLMProvider:
        api_key = os.getenv(profile.api_key_env) if profile.api_key_env else None
        try:
            return create_provider(profile, api_key)
        except ValueError as exc:
            raise AIServiceError(
                "AI_SERVICE_NOT_READY",
                f"Profile {profile_name} is not configured",
                status_code=503,
                retryable=True,
            ) from exc


async def _prepend_chunk(
    first_chunk: ProviderStreamChunk | None,
    remaining_chunks: AsyncIterator[ProviderStreamChunk],
) -> AsyncIterator[ProviderStreamChunk]:
    try:
        if first_chunk is not None:
            yield first_chunk
        async for chunk in remaining_chunks:
            yield chunk
    finally:
        close = getattr(remaining_chunks, "aclose", None)
        if close is not None:
            await close()


def _validate_json_schema(schema: dict[str, Any] | None, request_id: str) -> None:
    if schema is None:
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "json_schema response format requires a schema",
            status_code=422,
            request_id=request_id,
        )
    encoded = json.dumps(schema, ensure_ascii=False).encode("utf-8")
    if len(encoded) > 32 * 1024:
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "JSON Schema exceeds 32 KiB",
            status_code=422,
            request_id=request_id,
        )
    if schema.get("type") != "object":
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "JSON Schema root type must be object",
            status_code=422,
            request_id=request_id,
        )
    if _contains_remote_ref(schema):
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "Remote JSON Schema references are not allowed",
            status_code=422,
            request_id=request_id,
        )
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "JSON Schema is invalid",
            status_code=422,
            request_id=request_id,
        ) from exc


def _contains_remote_ref(value: Any) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref" and isinstance(item, str) and not item.startswith("#"):
                return True
            if _contains_remote_ref(item):
                return True
    elif isinstance(value, list):
        return any(_contains_remote_ref(item) for item in value)
    return False
