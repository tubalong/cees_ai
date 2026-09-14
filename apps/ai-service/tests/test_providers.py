from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage

from app.core.config import OutputMode
from app.core.errors import ProviderOutputError
from app.llm.providers import (
    OpenAICompatibleProvider,
    _coalesce_tool_call_chunks,
    _to_langchain_message,
)
from app.llm.types import ChatMessage, InvocationOptions, ToolCall
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
async def test_deepseek_reasoning_invocation_enables_thinking_with_effort() -> None:
    chat_model = FakeStreamingChatModel()
    provider = object.__new__(OpenAICompatibleProvider)
    provider.profile = profile(provider="deepseek")
    provider.chat_model = chat_model
    options = InvocationOptions(
        temperature=0.4,
        max_output_tokens=1024,
        output_mode=OutputMode.text,
        reasoning_effort="low",
    )

    await provider.invoke([ChatMessage(role="user", content="plan")], options)

    assert chat_model.invoke_calls[0][1] == {
        "temperature": 0.4,
        "reasoning_effort": "low",
        "extra_body": {
            "max_tokens": 1024,
            "thinking": {"type": "enabled"},
        },
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

class FakeToolChatModel:
    def __init__(self) -> None:
        self.bind_calls: list[tuple[list[dict[str, Any]], dict[str, Any]]] = []
        self.invoke_calls: list[tuple[list[object], dict[str, Any]]] = []

    def bind_tools(self, tools: list[dict[str, Any]], **kwargs: Any) -> FakeToolChatModel:
        self.bind_calls.append((tools, kwargs))
        return self

    async def ainvoke(self, messages: list[object], **kwargs: Any) -> AIMessage:
        self.invoke_calls.append((messages, kwargs))
        return AIMessage(
            content="",
            tool_calls=[
                {
                    "id": "call_1",
                    "name": "generate_image",
                    "args": {"prompt": "a cat"},
                }
            ],
            response_metadata={"finish_reason": "tool_calls"},
        )


class FakeStreamingToolChatModel:
    def __init__(self) -> None:
        self.bind_calls: list[tuple[list[dict[str, Any]], dict[str, Any]]] = []
        self.calls: list[tuple[list[object], dict[str, Any]]] = []

    def bind_tools(
        self, tools: list[dict[str, Any]], **kwargs: Any
    ) -> FakeStreamingToolChatModel:
        self.bind_calls.append((tools, kwargs))
        return self

    async def astream(
        self, messages: list[object], **kwargs: Any
    ) -> AsyncIterator[AIMessageChunk]:
        self.calls.append((messages, kwargs))
        yield AIMessageChunk(
            content="",
            tool_call_chunks=[
                {"name": "generate_image", "args": '{"prompt":', "id": "call_1", "index": 0}
            ],
        )
        yield AIMessageChunk(
            content="",
            tool_call_chunks=[{"name": None, "args": '"a cat"}', "id": None, "index": 0}],
        )
        yield AIMessageChunk(
            content="",
            response_metadata={"finish_reason": "tool_calls"},
            usage_metadata={
                "input_tokens": 12,
                "output_tokens": 4,
                "total_tokens": 16,
            },
        )


@pytest.mark.asyncio
async def test_invoke_with_tools_binds_tools_and_returns_tool_calls() -> None:
    chat_model = FakeToolChatModel()
    provider = object.__new__(OpenAICompatibleProvider)
    provider.profile = profile(provider="deepseek")
    provider.chat_model = chat_model
    tool = {
        "name": "generate_image",
        "description": "Generate an image",
        "parameters": {"type": "object", "properties": {"prompt": {"type": "string"}}},
    }
    options = InvocationOptions(
        temperature=0.2,
        max_output_tokens=256,
        output_mode=OutputMode.text,
        tools=(tool,),
    )

    result = await provider.invoke_with_tools(
        [ChatMessage(role="user", content="draw a cat")], options
    )

    assert result.content == ""
    assert result.tool_calls == (
        ToolCall(id="call_1", name="generate_image", arguments={"prompt": "a cat"}),
    )
    assert result.finish_reason == "tool_calls"
    assert chat_model.bind_calls[0][0] == [tool]
    assert chat_model.bind_calls[0][1] == {"tool_choice": "auto"}
    assert chat_model.invoke_calls[0][1] == {
        "temperature": 0.2,
        "extra_body": {
            "max_tokens": 256,
            "thinking": {"type": "disabled"},
        },
    }


@pytest.mark.asyncio
async def test_stream_with_tools_coalesces_tool_call_chunks() -> None:
    chat_model = FakeStreamingToolChatModel()
    provider = object.__new__(OpenAICompatibleProvider)
    provider.profile = profile()
    provider.chat_model = chat_model
    options = InvocationOptions(
        temperature=0.2,
        max_output_tokens=256,
        output_mode=OutputMode.text,
        tools=(
            {
                "name": "generate_image",
                "description": "Generate an image",
                "parameters": {"type": "object"},
            },
        ),
    )

    chunks = [
        chunk
        async for chunk in provider.stream_with_tools(
            [ChatMessage(role="user", content="draw a cat")], options
        )
    ]

    assert chunks[-1].tool_calls == (
        ToolCall(id="call_1", name="generate_image", arguments={"prompt": "a cat"}),
    )
    assert chunks[-1].finish_reason == "tool_calls"
    assert chunks[-1].token_usage is not None
    assert chunks[-1].token_usage.total_tokens == 16
    assert chat_model.bind_calls[0][1] == {"tool_choice": "auto"}


def test_converts_tool_and_assistant_tool_call_messages_to_langchain() -> None:
    tool_message = _to_langchain_message(
        ChatMessage(role="tool", content="generated", tool_call_id="call_1")
    )
    assistant_message = _to_langchain_message(
        ChatMessage(
            role="assistant",
            content="",
            tool_calls=(
                ToolCall(id="call_1", name="generate_image", arguments={"prompt": "a cat"}),
            ),
        )
    )

    assert isinstance(tool_message, ToolMessage)
    assert tool_message.tool_call_id == "call_1"
    assert isinstance(assistant_message, AIMessage)
    assert assistant_message.tool_calls == [
        {
            "id": "call_1",
            "name": "generate_image",
            "args": {"prompt": "a cat"},
            "type": "tool_call",
        }
    ]


def test_coalesce_tool_call_chunks_rejects_non_object_arguments() -> None:
    with pytest.raises(ProviderOutputError):
        _coalesce_tool_call_chunks(
            [
                {"name": "generate_image", "args": '"not-an-object"', "id": "call_1", "index": 0}
            ]
        )


def test_to_langchain_message_preserves_multimodal_content() -> None:
    message = ChatMessage(
        role="user",
        content=[
            {"type": "text", "text": "What is in this image?"},
            {
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64,abc"},
            },
        ],
    )

    converted = _to_langchain_message(message)

    assert isinstance(converted, HumanMessage)
    assert converted.content == [
        {"type": "text", "text": "What is in this image?"},
        {
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,abc"},
        },
    ]
