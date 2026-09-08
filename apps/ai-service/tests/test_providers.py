from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

from app.core.config import OutputMode
from app.llm.providers import OpenAICompatibleProvider
from app.llm.types import ChatMessage, InvocationOptions
from tests.helpers import profile


class FakeStreamingChatModel:
    def __init__(self) -> None:
        self.invoke_calls: list[tuple[list[object], dict[str, Any]]] = []
        self.calls: list[tuple[list[object], dict[str, Any]]] = []

    async def ainvoke(self, messages: list[object], **kwargs: Any) -> AIMessage:
        self.invoke_calls.append((messages, kwargs))
        return AIMessage(content="done", response_metadata={"finish_reason": "length"})

    async def astream(
        self, messages: list[object], **kwargs: Any
    ) -> AsyncIterator[AIMessageChunk]:
        self.calls.append((messages, kwargs))
        yield AIMessageChunk(content="hel")
        yield AIMessageChunk(content="lo")
        yield AIMessageChunk(
            content="",
            response_metadata={"finish_reason": "length"},
            usage_metadata={
                "input_tokens": 3,
                "output_tokens": 2,
                "total_tokens": 5,
            },
        )


class FakeStructuredRunnable:
    def __init__(self) -> None:
        self.calls: list[tuple[list[object], dict[str, Any]]] = []

    async def ainvoke(self, messages: list[object], **kwargs: Any) -> dict[str, object]:
        self.calls.append((messages, kwargs))
        return {
            "raw": AIMessage(
                content="",
                response_metadata={"finish_reason": "stop"},
                usage_metadata={
                    "input_tokens": 3,
                    "output_tokens": 2,
                    "total_tokens": 5,
                },
            ),
            "parsed": {"answer": 42},
            "parsing_error": None,
        }


class FakeStructuredChatModel:
    def __init__(self) -> None:
        self.bind_calls: list[tuple[dict[str, object], dict[str, Any]]] = []
        self.runnable = FakeStructuredRunnable()

    def with_structured_output(
        self, schema: dict[str, object], **kwargs: Any
    ) -> FakeStructuredRunnable:
        self.bind_calls.append((schema, kwargs))
        return self.runnable


@pytest.mark.asyncio
async def test_openai_compatible_provider_streams_text_and_usage() -> None:
    chat_model = FakeStreamingChatModel()
    provider = object.__new__(OpenAICompatibleProvider)
    provider.profile = profile()
    provider.chat_model = chat_model
    options = InvocationOptions(
        temperature=0.4,
        max_output_tokens=128,
        output_mode=OutputMode.text,
    )

    chunks = [
        chunk
        async for chunk in provider.stream(
            [ChatMessage(role="user", content="hello")], options
        )
    ]

    assert [chunk.text for chunk in chunks] == ["hel", "lo", ""]
    assert chunks[-1].token_usage is not None
    assert chunks[-1].token_usage.total_tokens == 5
    assert chunks[-1].finish_reason == "length"
    assert chat_model.calls[0][1] == {
        "stream_usage": True,
        "temperature": 0.4,
        "max_completion_tokens": 128,
    }


@pytest.mark.asyncio
async def test_deepseek_provider_uses_max_tokens_for_invoke_and_stream() -> None:
    chat_model = FakeStreamingChatModel()
    provider = object.__new__(OpenAICompatibleProvider)
    provider.profile = profile(provider="deepseek")
    provider.chat_model = chat_model
    options = InvocationOptions(
        temperature=0.4,
        max_output_tokens=7,
        output_mode=OutputMode.text,
    )
    messages = [ChatMessage(role="user", content="hello")]

    result = await provider.invoke(messages, options)
    chunks = [chunk async for chunk in provider.stream(messages, options)]

    assert chunks
    assert result.finish_reason == "length"
    assert chunks[-1].finish_reason == "length"
    assert chat_model.invoke_calls[0][1] == {
        "temperature": 0.4,
        "extra_body": {"max_tokens": 7},
    }
    assert chat_model.calls[0][1] == {
        "stream_usage": True,
        "temperature": 0.4,
        "extra_body": {"max_tokens": 7},
    }


@pytest.mark.asyncio
async def test_deepseek_structured_output_disables_thinking_before_binding_tools() -> None:
    chat_model = FakeStructuredChatModel()
    provider = object.__new__(OpenAICompatibleProvider)
    provider.profile = profile(provider="deepseek", modes={OutputMode.json_schema})
    provider.chat_model = chat_model
    options = InvocationOptions(
        temperature=0.2,
        max_output_tokens=512,
        output_mode=OutputMode.json_schema,
        schema_name="Answer",
        json_schema={
            "type": "object",
            "properties": {"answer": {"type": "integer"}},
            "required": ["answer"],
        },
    )

    result = await provider.invoke([ChatMessage(role="user", content="answer")], options)

    assert result.output == {"answer": 42}
    assert chat_model.bind_calls[0][1] == {
        "method": "function_calling",
        "include_raw": True,
        "temperature": 0.2,
        "extra_body": {
            "max_tokens": 512,
            "thinking": {"type": "disabled"},
        },
    }
    assert chat_model.runnable.calls[0][1] == {}


@pytest.mark.asyncio
async def test_openai_compatible_structured_output_binds_completion_parameters() -> None:
    chat_model = FakeStructuredChatModel()
    provider = object.__new__(OpenAICompatibleProvider)
    provider.profile = profile(modes={OutputMode.json_schema})
    provider.chat_model = chat_model
    options = InvocationOptions(
        temperature=0.1,
        max_output_tokens=256,
        output_mode=OutputMode.json_schema,
        schema_name="Answer",
        json_schema={
            "type": "object",
            "properties": {"answer": {"type": "integer"}},
            "required": ["answer"],
        },
    )

    await provider.invoke([ChatMessage(role="user", content="answer")], options)

    assert chat_model.bind_calls[0][1] == {
        "method": "function_calling",
        "include_raw": True,
        "temperature": 0.1,
        "max_completion_tokens": 256,
    }
    assert chat_model.runnable.calls[0][1] == {}