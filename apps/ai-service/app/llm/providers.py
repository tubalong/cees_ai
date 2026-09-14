from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

from app.core.config import ModelProfile, OutputMode
from app.core.errors import ProviderOutputError, ProviderPermanentError, ProviderTransientError
from app.llm.types import (
    ChatMessage,
    InvocationOptions,
    LLMProvider,
    MessageContent,
    ProviderResult,
    ProviderStreamChunk,
    TokenUsageData,
    ToolCall,
    ToolCallingResult,
    content_to_text,
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
            (
                content_to_text(message.content)
                for message in reversed(messages)
                if message.role == "user"
            ),
            ""
        )
        return ProviderResult(output=f"mock:{last_user_message}", finish_reason="stop")

    async def stream(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]:
        if options.output_mode != OutputMode.text:
            raise ProviderPermanentError("mock profiles support text output only")
        last_user_message = next(
            (
                content_to_text(message.content)
                for message in reversed(messages)
                if message.role == "user"
            ),
            ""
        )
        yield ProviderStreamChunk(text=f"mock:{last_user_message}", finish_reason="stop")

    async def invoke_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ToolCallingResult:
        raise ProviderPermanentError("mock profiles do not support tool calling")

    async def stream_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]:
        raise ProviderPermanentError("mock profiles do not support tool calling")
        yield  # pragma: no cover


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
        invocation_kwargs = _invocation_kwargs(self.profile, options)
        try:
            if options.output_mode == OutputMode.text:
                response = await self.chat_model.ainvoke(langchain_messages, **invocation_kwargs)
                return ProviderResult(
                    output=_message_text(response),
                    token_usage=_extract_usage(response),
                    finish_reason=_extract_finish_reason(response),
                )

            if options.json_schema is None or options.schema_name is None:
                raise ProviderPermanentError("json_schema output requires a schema and name")
            schema = {"title": options.schema_name, **options.json_schema}
            structured_model = self.chat_model.with_structured_output(
                schema,
                method=self.profile.structured_output_method,
                include_raw=True,
                **invocation_kwargs,
            )
            structured = await structured_model.ainvoke(langchain_messages)
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
                finish_reason=_extract_finish_reason(raw) if raw is not None else None,
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
        invocation_kwargs = _invocation_kwargs(self.profile, options)
        try:
            async for response in self.chat_model.astream(
                langchain_messages,
                stream_usage=True,
                **invocation_kwargs,
            ):
                text = _message_text(response)
                token_usage = _extract_usage(response)
                finish_reason = _extract_finish_reason(response)
                if text or _has_token_usage(token_usage) or finish_reason is not None:
                    yield ProviderStreamChunk(
                        text=text,
                        token_usage=token_usage if _has_token_usage(token_usage) else None,
                        finish_reason=finish_reason,
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

    async def invoke_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> ToolCallingResult:
        if not options.tools:
            raise ProviderPermanentError("tool calling requires at least one tool")
        langchain_messages = [_to_langchain_message(message) for message in messages]
        bound_model = self._bind_tools(options.tools)
        invocation_kwargs = _invocation_kwargs(self.profile, options)
        try:
            response = await bound_model.ainvoke(langchain_messages, **invocation_kwargs)
            tool_calls = _extract_tool_calls(response)
            return ToolCallingResult(
                content=_message_text(response),
                tool_calls=tool_calls,
                token_usage=_extract_usage(response),
                finish_reason=_extract_finish_reason(response),
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

    async def stream_with_tools(
        self, messages: list[ChatMessage], options: InvocationOptions
    ) -> AsyncIterator[ProviderStreamChunk]:
        if not options.tools:
            raise ProviderPermanentError("tool calling requires at least one tool")
        langchain_messages = [_to_langchain_message(message) for message in messages]
        bound_model = self._bind_tools(options.tools)
        invocation_kwargs = _invocation_kwargs(self.profile, options)
        tool_call_chunks: list[Any] = []
        token_usage: TokenUsageData | None = None
        finish_reason: str | None = None
        try:
            async for response in bound_model.astream(
                langchain_messages,
                stream_usage=True,
                **invocation_kwargs,
            ):
                chunk_tool_calls = getattr(response, "tool_call_chunks", None)
                if chunk_tool_calls:
                    tool_call_chunks.extend(chunk_tool_calls)
                else:
                    text = _message_text(response)
                    if text:
                        yield ProviderStreamChunk(text=text)

                current_usage = _extract_usage(response)
                if _has_token_usage(current_usage):
                    token_usage = current_usage
                current_finish_reason = _extract_finish_reason(response)
                if current_finish_reason is not None:
                    finish_reason = current_finish_reason

            if tool_call_chunks:
                yield ProviderStreamChunk(
                    tool_calls=_coalesce_tool_call_chunks(tool_call_chunks),
                    token_usage=token_usage,
                    finish_reason=finish_reason,
                )
            else:
                yield ProviderStreamChunk(
                    token_usage=token_usage,
                    finish_reason=finish_reason,
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

    def _bind_tools(self, tools: tuple[dict[str, Any], ...]) -> Any:
        return self.chat_model.bind_tools(list(tools), tool_choice="auto")


def create_provider(profile: ModelProfile, api_key: str | None = None) -> LLMProvider:
    if profile.provider == "mock":
        return MockLLMProvider(profile)
    if api_key is None:
        raise ValueError("api_key is required for non-mock providers")
    return OpenAICompatibleProvider(profile, api_key)


def _to_langchain_message(
    message: ChatMessage,
) -> SystemMessage | HumanMessage | AIMessage | ToolMessage:
    content = _to_langchain_content(message.content)
    if message.role == "system":
        return SystemMessage(content=content)
    if message.role == "assistant":
        return AIMessage(
            content=content,
            tool_calls=[tool_call_to_dict(tool_call) for tool_call in message.tool_calls],
        )
    if message.role == "tool":
        return ToolMessage(
            content=content_to_text(message.content),
            tool_call_id=message.tool_call_id or "",
        )
    return HumanMessage(content=content)


def _to_langchain_content(content: MessageContent) -> str | list[dict[str, Any]]:
    if isinstance(content, str):
        return content
    parts: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            parts.append({"type": "text", "text": part.get("text", "")})
        elif part.get("type") == "image_url":
            image_url = part.get("image_url")
            if isinstance(image_url, dict):
                parts.append({"type": "image_url", "image_url": {"url": image_url.get("url", "")}})
    return parts


def tool_call_to_dict(tool_call: ToolCall) -> dict[str, Any]:
    return {
        "id": tool_call.id,
        "name": tool_call.name,
        "args": tool_call.arguments,
    }


def _invocation_kwargs(
    profile: ModelProfile, options: InvocationOptions
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"temperature": options.temperature}
    if profile.provider == "deepseek":
        extra_body: dict[str, Any] = {"max_tokens": options.max_output_tokens}
        if options.tools:
            extra_body["thinking"] = {"type": "disabled"}
        elif options.output_mode == OutputMode.json_schema:
            extra_body["thinking"] = {"type": "disabled"}
        elif options.reasoning_effort is not None:
            extra_body["thinking"] = {"type": "enabled"}
            kwargs["reasoning_effort"] = options.reasoning_effort
        kwargs["extra_body"] = extra_body
    else:
        kwargs["max_completion_tokens"] = options.max_output_tokens
    return kwargs


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


def _extract_finish_reason(message: Any) -> str | None:
    metadata = getattr(message, "response_metadata", None)
    if not isinstance(metadata, dict):
        return None
    finish_reason = metadata.get("finish_reason")
    return finish_reason if isinstance(finish_reason, str) else None


def _extract_tool_calls(message: Any) -> tuple[ToolCall, ...]:
    raw_calls = getattr(message, "tool_calls", None) or []
    calls: list[ToolCall] = []
    for index, raw in enumerate(raw_calls):
        calls.append(_normalize_tool_call(raw, index))
    return tuple(calls)


def _coalesce_tool_call_chunks(chunks: list[Any]) -> tuple[ToolCall, ...]:
    by_index: dict[int, dict[str, Any]] = {}
    for chunk in chunks:
        index = _chunk_value(chunk, "index")
        if index is None:
            continue
        entry = by_index.setdefault(index, {"id": None, "name": None, "arguments": ""})
        chunk_id = _chunk_value(chunk, "id")
        if chunk_id:
            entry["id"] = chunk_id
        chunk_name = _chunk_value(chunk, "name")
        if chunk_name:
            entry["name"] = chunk_name
        args = _chunk_value(chunk, "args", "")
        if isinstance(args, str):
            entry["arguments"] += args
        elif isinstance(args, dict):
            entry["arguments"] = args

    calls: list[ToolCall] = []
    for index in sorted(by_index):
        entry = by_index[index]
        call_id = entry["id"] or f"call_{index}"
        name = entry["name"]
        if not isinstance(name, str) or not name:
            raise ProviderOutputError("streamed tool call is missing a name")
        arguments = entry["arguments"]
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments or "{}")
            except json.JSONDecodeError as exc:
                raise ProviderOutputError(
                    "streamed tool call arguments are not valid JSON"
                ) from exc
        if not isinstance(arguments, dict):
            raise ProviderOutputError("streamed tool call arguments must be an object")
        calls.append(ToolCall(id=call_id, name=name, arguments=arguments))
    return tuple(calls)


def _chunk_value(chunk: Any, key: str, default: Any = None) -> Any:
    if isinstance(chunk, dict):
        return chunk.get(key, default)
    return getattr(chunk, key, default)


def _normalize_tool_call(raw: Any, index: int) -> ToolCall:
    if isinstance(raw, dict):
        name = raw.get("name")
        call_id = raw.get("id")
        arguments = raw.get("args", {})
    else:
        name = getattr(raw, "name", None)
        call_id = getattr(raw, "id", None)
        arguments = getattr(raw, "args", {})
    if not isinstance(name, str) or not name:
        raise ProviderOutputError("provider returned a tool call without a name")
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments or "{}")
        except json.JSONDecodeError as exc:
            raise ProviderOutputError("tool call arguments are not valid JSON") from exc
    if not isinstance(arguments, dict):
        raise ProviderOutputError("tool call arguments must be an object")
    return ToolCall(id=call_id or f"call_{index}", name=name, arguments=arguments)


def _has_token_usage(usage: TokenUsageData) -> bool:
    return any(
        value is not None
        for value in (usage.input_tokens, usage.output_tokens, usage.total_tokens)
    )
