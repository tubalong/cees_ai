from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from langchain_core.messages import AIMessageChunk

from app.core.config import OutputMode
from app.llm.providers import OpenAICompatibleProvider
from app.llm.types import ChatMessage, InvocationOptions
from tests.helpers import profile


class FakeStreamingChatModel:
    def __init__(self) -> None:
        self.calls: list[tuple[list[object], dict[str, Any]]] = []

    async def astream(
        self, messages: list[object], **kwargs: Any
    ) -> AsyncIterator[AIMessageChunk]:
        self.calls.append((messages, kwargs))
        yield AIMessageChunk(content="hel")
        yield AIMessageChunk(content="lo")
        yield AIMessageChunk(
            content="",
            usage_metadata={
                "input_tokens": 3,
                "output_tokens": 2,
                "total_tokens": 5,
            },
        )


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
    assert chat_model.calls[0][1] == {
        "stream_usage": True,
        "temperature": 0.4,
        "max_completion_tokens": 128,
    }