from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel, BaseLanguageModel
from langchain_core.messages import (
    AIMessage as LangChainAIMessage,
)
from langchain_core.messages import (
    BaseMessage as LangChainMessage,
)
from langchain_core.messages import (
    HumanMessage,
    SystemMessage,
)
from llama_index.core.base.llms.types import (
    ChatMessage,
    ChatResponse,
    CompletionResponse,
    LLMMetadata,
    MessageRole,
)
from llama_index.core.llms.callbacks import llm_chat_callback, llm_completion_callback
from llama_index.embeddings.langchain import LangchainEmbedding
from llama_index.llms.langchain import LangChainLLM


class CompatibleLangChainLLM(LangChainLLM):
    """Non-streaming LangChain 1.x bridge that avoids legacy community model imports."""

    @property
    def metadata(self) -> LLMMetadata:
        model = self.llm
        model_name = (
            getattr(model, "model_name", None)
            or getattr(model, "model", None)
            or type(model).__name__
        )
        num_output = getattr(model, "max_completion_tokens", None) or 256
        return LLMMetadata(
            context_window=3900,
            num_output=num_output,
            is_chat_model=isinstance(model, BaseChatModel),
            model_name=str(model_name),
        )

    @llm_completion_callback()
    def complete(
        self, prompt: str, formatted: bool = False, **kwargs: Any
    ) -> CompletionResponse:
        if not formatted:
            assert self.completion_to_prompt is not None
            prompt = self.completion_to_prompt(prompt)
        output = self.llm.invoke(prompt, **kwargs)
        return CompletionResponse(text=_langchain_content(output), raw=output)

    @llm_completion_callback()
    async def acomplete(
        self, prompt: str, formatted: bool = False, **kwargs: Any
    ) -> CompletionResponse:
        if not formatted:
            assert self.completion_to_prompt is not None
            prompt = self.completion_to_prompt(prompt)
        output = await self.llm.ainvoke(prompt, **kwargs)
        return CompletionResponse(text=_langchain_content(output), raw=output)

    def stream_complete(self, prompt: str, formatted: bool = False, **kwargs: Any) -> Any:
        raise NotImplementedError("Streaming is not supported by the CEES LlamaIndex bridge")

    def stream_chat(self, messages: Sequence[ChatMessage], **kwargs: Any) -> Any:
        raise NotImplementedError("Streaming is not supported by the CEES LlamaIndex bridge")

    @llm_chat_callback()
    def chat(self, messages: Sequence[ChatMessage], **kwargs: Any) -> ChatResponse:
        output = self.llm.invoke([_to_langchain_message(message) for message in messages], **kwargs)
        return ChatResponse(
            message=ChatMessage(role=MessageRole.ASSISTANT, content=_langchain_content(output)),
            raw=output,
        )

    @llm_chat_callback()
    async def achat(self, messages: Sequence[ChatMessage], **kwargs: Any) -> ChatResponse:
        output = await self.llm.ainvoke(
            [_to_langchain_message(message) for message in messages], **kwargs
        )
        return ChatResponse(
            message=ChatMessage(role=MessageRole.ASSISTANT, content=_langchain_content(output)),
            raw=output,
        )


def to_llama_index_llm(model: BaseLanguageModel) -> LangChainLLM:
    """Wrap a request-scoped LangChain model without changing global LlamaIndex settings."""

    return CompatibleLangChainLLM(llm=model)


def to_llama_index_embedding(embeddings: Embeddings) -> LangchainEmbedding:
    """Wrap request-scoped LangChain embeddings without changing global settings."""

    return LangchainEmbedding(langchain_embeddings=embeddings)


def _to_langchain_message(message: ChatMessage) -> LangChainMessage:
    content = message.content or ""
    if message.role == MessageRole.SYSTEM:
        return SystemMessage(content=content)
    if message.role in {MessageRole.ASSISTANT, MessageRole.MODEL, MessageRole.CHATBOT}:
        return LangChainAIMessage(content=content)
    return HumanMessage(content=content)


def _langchain_content(output: Any) -> str:
    content = getattr(output, "content", output)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return str(content)
