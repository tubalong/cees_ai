from __future__ import annotations

from typing import TypedDict

import pytest
from langchain_core.embeddings import Embeddings
from langchain_core.language_models.fake import FakeListLLM
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from llama_index.core import Document, VectorStoreIndex

from app.core.config import ModelRole, OutputMode
from app.integrations.langgraph import WorkflowRuntimeContext
from app.integrations.llama_index import to_llama_index_embedding, to_llama_index_llm
from app.llm.router import LLMRouter
from app.llm.types import ChatMessage
from tests.helpers import StubProvider, catalog, profile, result


class GraphState(TypedDict):
    text: str
    output: str
    completed: bool


@pytest.mark.asyncio
async def test_langgraph_receives_router_through_runtime_context() -> None:
    model_profile = profile()
    provider = StubProvider(model_profile, [result("routed")])
    router = LLMRouter(
        catalog({"primary": model_profile}, {ModelRole.default: ["primary"]}),
        lambda _name, _profile: provider,
    )

    async def invoke_model(
        state: GraphState, runtime: Runtime[WorkflowRuntimeContext]
    ) -> GraphState:
        routed = await runtime.context.llm_router.invoke(
            request_id="graph-1",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content=state["text"])],
            output_mode=OutputMode.text,
            role=ModelRole.default,
            profile_override=None,
            temperature=None,
            max_output_tokens=None,
        )
        return {**state, "output": str(routed.provider_result.output)}

    def mark_complete(state: GraphState) -> GraphState:
        return {**state, "completed": True}

    graph = StateGraph(GraphState, context_schema=WorkflowRuntimeContext)
    graph.add_node("invoke", invoke_model)
    graph.add_node("complete", mark_complete)
    graph.add_edge(START, "invoke")
    graph.add_edge("invoke", "complete")
    graph.add_edge("complete", END)

    output = await graph.compile().ainvoke(
        {"text": "hello", "output": "", "completed": False},
        context=WorkflowRuntimeContext(llm_router=router),
    )
    assert output == {"text": "hello", "output": "routed", "completed": True}


class KeywordEmbeddings(Embeddings):
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)

    @staticmethod
    def _embed(text: str) -> list[float]:
        lowered = text.lower()
        return [1.0 if "alpha" in lowered else 0.0, 1.0 if "beta" in lowered else 0.0]


def test_llama_index_uses_request_scoped_langchain_embedding() -> None:
    embedding = to_llama_index_embedding(KeywordEmbeddings())
    index = VectorStoreIndex.from_documents(
        [Document(text="alpha document"), Document(text="beta document")],
        embed_model=embedding,
    )
    nodes = index.as_retriever(similarity_top_k=1).retrieve("alpha")
    assert len(nodes) == 1
    assert nodes[0].text == "alpha document"


def test_llama_index_uses_request_scoped_langchain_llm() -> None:
    llm = to_llama_index_llm(FakeListLLM(responses=["adapter-ok"]))
    assert llm.complete("hello").text == "adapter-ok"
