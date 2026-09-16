from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import ModelRole, OutputMode, Settings
from app.core.runtime import AppRuntime
from app.embeddings.router import build_default_embedding_router
from app.knowledge.stores import InMemoryVectorStore
from app.llm.router import LLMRouter
from app.main import create_app
from tests.helpers import StubProvider, catalog, profile, result

TOKEN_HEADERS = {"X-AI-Internal-Token": "secret"}


def index_payload() -> dict[str, object]:
    return {
        "request_id": "req-index-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "knowledge_base_id": "kb-1",
        "document_id": "doc-1",
        "document_version_id": "docv-1",
        "parsed_document": {
            "document_id": "doc-1",
            "document_version_id": "docv-1",
            "parser_name": "mineru",
            "parser_version": "2.5.1",
            "blocks": [
                {
                    "block_id": "block-1",
                    "type": "paragraph",
                    "text": "项目延期超过两周时需要升级到项目委员会。",
                    "source_order": 0,
                }
            ],
        },
        "chunking_version": "chunk-v1",
        "embedding_profile": "deterministic",
        "index_version": "idx-v1",
        "visibility_scope": {"visibility_scope": "TENANT", "acl_version": "acl-1"},
    }


def answer_payload() -> dict[str, object]:
    return {
        "request_id": "req-answer-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "query": "项目延期超过两周怎么办？",
        "scope": {"knowledge_base_ids": ["kb-1"], "acl_version": "acl-1"},
        "top_k": 8,
        "index_version": "idx-v1",
    }


def build_answer_client(provider: StubProvider) -> TestClient:
    rag_profile = profile(
        provider="mock",
        modes={OutputMode.text, OutputMode.json_schema},
        token_limit=4096,
    )
    model_catalog = catalog(
        profiles={"rag-mock": rag_profile},
        roles={ModelRole.rag: ["rag-mock"]},
    )
    router = LLMRouter(model_catalog, provider_builder=lambda name, prof: provider)
    runtime = AppRuntime(
        settings=Settings(node_env="test", ai_internal_token="secret"),
        catalog=model_catalog,
        router=router,
        readiness_errors=[],
        embedding_router=build_default_embedding_router(),
        knowledge_store=InMemoryVectorStore(),
    )
    return TestClient(create_app(runtime=runtime))


def test_answer_requires_internal_token() -> None:
    client = build_answer_client(
        StubProvider(
            profile(
                provider="mock",
                modes={OutputMode.text, OutputMode.json_schema},
            ),
            outcomes=[result({})],
        )
    )
    with client:
        response = client.post(
            "/internal/v1/knowledge/answer", json=answer_payload()
        )
    assert response.status_code == 401


def test_answer_short_circuits_on_empty_retrieval() -> None:
    provider = StubProvider(
        profile(
            provider="mock",
            modes={OutputMode.text, OutputMode.json_schema},
        ),
        outcomes=[result({})],
    )
    client = build_answer_client(provider)
    with client:
        response = client.post(
            "/internal/v1/knowledge/answer",
            json=answer_payload(),
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == ""
    assert body["grounded"] is False
    assert body["insufficient_evidence"] is True
    assert body["citations"] == []
    assert body["execution"] is None
    assert body["index_version"] == "idx-v1"
    assert body["embedding_profile"] == "deterministic"
    # 空结果短路不调用 LLM。
    assert provider.calls == []


def test_answer_maps_citations_back_to_chunks() -> None:
    provider = StubProvider(
        profile(
            provider="mock",
            modes={OutputMode.text, OutputMode.json_schema},
        ),
        outcomes=[
            result(
                {
                    "answer": "项目延期超过两周需要升级到项目委员会。",
                    "citation_ids": ["S1"],
                    "insufficient_evidence": False,
                }
            )
        ],
    )
    client = build_answer_client(provider)
    with client:
        indexed = client.post(
            "/internal/v1/knowledge/index",
            json=index_payload(),
            headers=TOKEN_HEADERS,
        )
        assert indexed.status_code == 200
        response = client.post(
            "/internal/v1/knowledge/answer",
            json=answer_payload(),
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["grounded"] is True
    assert body["insufficient_evidence"] is False
    assert body["answer"].startswith("项目延期")
    assert len(body["citations"]) == 1
    citation = body["citations"][0]
    assert citation["citation_id"] == "S1"
    assert citation["document_id"] == "doc-1"
    assert citation["document_version_id"] == "docv-1"
    assert citation["text"]
    assert body["execution"] is not None
    assert body["execution"]["profile"] == "rag-mock"


def test_answer_model_insufficient_evidence_is_refused() -> None:
    provider = StubProvider(
        profile(
            provider="mock",
            modes={OutputMode.text, OutputMode.json_schema},
        ),
        outcomes=[
            result(
                {
                    "answer": "根据材料无法确定。",
                    "citation_ids": [],
                    "insufficient_evidence": True,
                }
            )
        ],
    )
    client = build_answer_client(provider)
    with client:
        client.post(
            "/internal/v1/knowledge/index",
            json=index_payload(),
            headers=TOKEN_HEADERS,
        )
        response = client.post(
            "/internal/v1/knowledge/answer",
            json=answer_payload(),
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == ""
    assert body["grounded"] is False
    assert body["insufficient_evidence"] is True
    assert body["citations"] == []


def test_answer_rejects_citations_outside_retrieved_chunks() -> None:
    provider = StubProvider(
        profile(
            provider="mock",
            modes={OutputMode.text, OutputMode.json_schema},
        ),
        outcomes=[
            result(
                {
                    "answer": "项目延期超过两周需要升级。",
                    "citation_ids": ["S9"],
                    "insufficient_evidence": False,
                }
            )
        ],
    )
    client = build_answer_client(provider)
    with client:
        client.post(
            "/internal/v1/knowledge/index",
            json=index_payload(),
            headers=TOKEN_HEADERS,
        )
        response = client.post(
            "/internal/v1/knowledge/answer",
            json=answer_payload(),
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "LLM_OUTPUT_INVALID"
