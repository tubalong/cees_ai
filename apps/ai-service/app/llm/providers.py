from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

from app.core.config import ModelProfile, OutputMode
from app.core.errors import ProviderOutputError, ProviderPermanentError, ProviderTransientError
from app.llm.types import (
    ChatMessage,
    InvocationOptions,
    LLMProvider,
    ProviderResult,
    ProviderStreamChunk,
    TokenUsageData,
)


class MockLLMProvider:
    def __init__(self, profile: ModelProfile) -> None:
        self.profile = profile

    async def invoke(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ProviderResult:
        if options.output_mode != OutputMode.text:
            raise ProviderPermanentError("mock profiles support text output only")
        last_user_message = next(
            (message.content for message in reversed(messages) if message.role == "user"), ""
        )
        return ProviderResult(output=f"mock:{last_user_message}")

    async def stream(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]:
        if options.output_mode != OutputMode.text:
            raise ProviderPermanentError("mock profiles support text output only")
        last_user_message = next(
            (message.content for message in reversed(messages) if message.role == "user"), ""
        )
        yield ProviderStreamChunk(text=f"mock:{last_user_message}")


class OpenAICompatibleProvider:
    def __init__(self, profile: ModelProfile, api_key: str) -> None:
        self.profile = profile
        self.chat_model = ChatOpenAI(
            model=profile.model,
            api_key=api_key,
            base_url=profile.base_url,
            timeout=profile.timeout_seconds,
            max_retries=profile.max_retries,
            temperature=profile.temperature,
        )

    async def invoke(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ProviderResult:
        langchain_messages = [_to_langchain_message(message) for message in messages]
        invocation_kwargs = {
            "temperature": options.temperature,
            "max_completion_tokens": options.max_output_tokens,
        }
        try:
            if options.output_mode == OutputMode.text:
                response = await self.chat_model.ainvoke(langchain_messages, **invocation_kwargs)
                return ProviderResult(
                    output=_message_text(response), token_usage=_extract_usage(response)
                )

            if options.json_schema is None or options.schema_name is None:
                raise ProviderPermanentError("json_schema output requires a schema and name")
            schema = {"title": options.schema_name, **options.json_schema}
            structured_model = self.chat_model.with_structured_output(
                schema,
                method=self.profile.structured_output_method,
                include_raw=True,
            )
            structured = await structured_model.ainvoke(langchain_messages, **invocation_kwargs)
            if not isinstance(structured, dict):
                raise ProviderOutputError("structured provider response has an invalid shape")
            parsing_error = structured.get("parsing_error")
            if parsing_error is not None:
                raise ProviderOutputError(
                    "provider returned invalid structured output"
                ) from parsing_error
            parsed = structured.get("parsed")
            if not isinstance(parsed, dict):
                raise ProviderOutputError("provider returned non-object structured output")
            raw = structured.get("raw")
            return ProviderResult(
                output=parsed,
                token_usage=_extract_usage(raw) if raw is not None else TokenUsageData(),
            )
        except (APIConnectionError, APITimeoutError, RateLimitError) as exc:
            raise ProviderTransientError(type(exc).__name__) from exc
        except APIStatusError as exc:
            if exc.status_code >= 500:
                raise ProviderTransientError(f"provider status {exc.status_code}") from exc
            raise ProviderPermanentError(f"provider status {exc.status_code}") from exc
        except ProviderOutputError:
            raise
        except ProviderPermanentError:
            raise
        except Exception as exc:
            raise ProviderPermanentError(type(exc).__name__) from exc

    async def stream(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]:
        if options.output_mode != OutputMode.text:
            raise ProviderPermanentError("streaming supports text output only")
        langchain_messages = [_to_langchain_message(message) for message in messages]
        invocation_kwargs = {
            "temperature": options.temperature,
            "max_completion_tokens": options.max_output_tokens,
        }
        try:
            async for response in self.chat_model.astream(
                langchain_messages,
                stream_usage=True,
                **invocation_kwargs,
            ):
                text = _message_text(response)
                token_usage = _extract_usage(response)
                if text or _has_token_usage(token_usage):
                    yield ProviderStreamChunk(
                        text=text,
                        token_usage=token_usage if _has_token_usage(token_usage) else None,
                    )
        except (APIConnectionError, APITimeoutError, RateLimitError) as exc:
            raise ProviderTransientError(type(exc).__name__) from exc
        except APIStatusError as exc:
            if exc.status_code >= 500:
                raise ProviderTransientError(f"provider status {exc.status_code}") from exc
            raise ProviderPermanentError(f"provider status {exc.status_code}") from exc
        except ProviderPermanentError:
            raise
        except Exception as exc:
            raise ProviderPermanentError(type(exc).__name__) from exc


def create_provider(profile: ModelProfile, api_key: str | None = None) -> LLMProvider:
    if profile.provider == "mock":
        return MockLLMProvider(profile)
    if api_key is None:
        raise ValueError("api_key is required for non-mock providers")
    return OpenAICompatibleProvider(profile, api_key)


def _to_langchain_message(message: ChatMessage) -> SystemMessage | HumanMessage | AIMessage:
    if message.role == "system":
        return SystemMessage(content=message.content)
    if message.role == "assistant":
        return AIMessage(content=message.content)
    return HumanMessage(content=message.content)


def _message_text(message: Any) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return str(content)


def _extract_usage(message: Any) -> TokenUsageData:
    usage = getattr(message, "usage_metadata", None)
    if isinstance(usage, dict):
        return TokenUsageData(
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            total_tokens=usage.get("total_tokens"),
        )
    metadata = getattr(message, "response_metadata", None)
    token_usage = metadata.get("token_usage", {}) if isinstance(metadata, dict) else {}
    return TokenUsageData(
        input_tokens=token_usage.get("prompt_tokens"),
        output_tokens=token_usage.get("completion_tokens"),
        total_tokens=token_usage.get("total_tokens"),
    )


def _has_token_usage(usage: TokenUsageData) -> bool:
    return any(
        value is not None
        for value in (usage.input_tokens, usage.output_tokens, usage.total_tokens)
    )
