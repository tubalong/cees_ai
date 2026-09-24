from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.runtime import AppRuntime
from app.embeddings.router import EmbeddingRouter, build_default_embedding_router
from app.knowledge.pgvector_store import PGVectorStoreGateway
from app.knowledge.stores import InMemoryVectorStore
from app.main import create_app

TOKEN_HEADERS = {"X-AI-Internal-Token": "secret"}


class _MismatchedEmbeddingProvider:
    """返回与声明维度不符的向量，模拟服务端配置错误。"""

    dimension = 384

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0, 1.0] for _ in texts]

    async def embed_query(self, text: str) -> list[float]:
        return [0.0, 1.0]


def build_knowledge_client() -> TestClient:
    settings = Settings(
        node_env="test",
        ai_internal_token="secret",
        ai_docs_enabled=False,
    )
    runtime = AppRuntime(
        settings=settings,
        catalog=None,
        router=None,
        readiness_errors=[],
        embedding_router=build_default_embedding_router(),
        knowledge_store=InMemoryVectorStore(),
    )
    return TestClient(create_app(runtime=runtime))


def test_readiness_reports_the_knowledge_index_identity() -> None:
    # 索引 Worker 依赖该字段判断存量向量是否随 ai-service 重启丢失；
    # 缺失或语义错误会导致文档长期停留在 READY 但检索永远为空。
    client = build_knowledge_client()
    with client:
        payload = client.get("/ready").json()
    index = payload["knowledge_index"]
    assert index["backend"] == "memory"
    assert index["durable"] is False
    assert index["epoch"]


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


def retrieve_payload() -> dict[str, object]:
    return {
        "request_id": "req-retrieve-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "query": "项目延期超过两周",
        "scope": {"knowledge_base_ids": ["kb-1"], "acl_version": "acl-1"},
        "top_k": 8,
        "index_version": "idx-v1",
    }


def delete_payload() -> dict[str, object]:
    return {
        "request_id": "req-delete-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "document_version_id": "docv-1",
        "index_version": "idx-v1",
    }


def test_knowledge_endpoints_require_internal_token() -> None:
    client = build_knowledge_client()
    with client:
        assert (
            client.post("/internal/v1/knowledge/index", json=index_payload()).status_code
            == 401
        )
        assert (
            client.post(
                "/internal/v1/knowledge/retrieve", json=retrieve_payload()
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/internal/v1/knowledge/index/delete", json=delete_payload()
            ).status_code
            == 401
        )


def test_index_then_retrieve_over_http() -> None:
    client = build_knowledge_client()
    with client:
        index_response = client.post(
            "/internal/v1/knowledge/index",
            json=index_payload(),
            headers=TOKEN_HEADERS,
        )
        assert index_response.status_code == 200
        body = index_response.json()
        assert body["indexed_chunks"] == 1
        assert body["embedding_profile"] == "deterministic"
        assert body["index_version"] == "idx-v1"

        retrieve_response = client.post(
            "/internal/v1/knowledge/retrieve",
            json=retrieve_payload(),
            headers=TOKEN_HEADERS,
        )
        assert retrieve_response.status_code == 200
        retrieved = retrieve_response.json()
        assert retrieved["index_version"] == "idx-v1"
        assert retrieved["embedding_profile"] == "deterministic"
        assert len(retrieved["chunks"]) == 1
        assert retrieved["chunks"][0]["document_id"] == "doc-1"


def test_index_identity_mismatch_returns_400() -> None:
    client = build_knowledge_client()
    payload = index_payload()
    payload["document_id"] = "doc-other"
    with client:
        response = client.post(
            "/internal/v1/knowledge/index",
            json=payload,
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_KNOWLEDGE_INDEX_REQUEST"


def test_index_without_text_blocks_returns_400() -> None:
    client = build_knowledge_client()
    payload = index_payload()
    payload["parsed_document"]["blocks"] = [
        {"block_id": "block-img", "type": "image", "source_order": 0}
    ]
    with client:
        response = client.post(
            "/internal/v1/knowledge/index",
            json=payload,
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_KNOWLEDGE_INDEX_REQUEST"


def test_retrieve_unknown_embedding_profile_returns_400() -> None:
    client = build_knowledge_client()
    payload = retrieve_payload()
    payload["embedding_profile"] = "nonexistent"
    with client:
        response = client.post(
            "/internal/v1/knowledge/retrieve",
            json=payload,
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_KNOWLEDGE_RETRIEVE_REQUEST"


def test_index_embedding_dimension_mismatch_returns_500() -> None:
    # embedding 维度不匹配是服务端配置错误，统一走 500（观察项修复）。
    settings = Settings(
        node_env="test", ai_internal_token="secret", ai_docs_enabled=False
    )
    runtime = AppRuntime(
        settings=settings,
        catalog=None,
        router=None,
        readiness_errors=[],
        embedding_router=EmbeddingRouter(
            profiles={"broken": _MismatchedEmbeddingProvider()},
            default_profile="broken",
        ),
        knowledge_store=InMemoryVectorStore(),
    )
    client = TestClient(create_app(runtime=runtime), raise_server_exceptions=False)
    payload = index_payload()
    payload["embedding_profile"] = "broken"
    with client:
        response = client.post(
            "/internal/v1/knowledge/index",
            json=payload,
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"


def test_index_deterministic_profile_on_pgvector_returns_500() -> None:
    # pgvector 表维度固定（KNOWLEDGE_VECTOR_DIMENSION），内置 deterministic
    # profile 必须前置拒绝为配置错误（retryable=False），而不是拖到
    # upsert 阶段才报维度不匹配。
    settings = Settings(
        node_env="test", ai_internal_token="secret", ai_docs_enabled=False
    )
    runtime = AppRuntime(
        settings=settings,
        catalog=None,
        router=None,
        readiness_errors=[],
        embedding_router=build_default_embedding_router(),
        knowledge_store=object.__new__(PGVectorStoreGateway),
    )
    client = TestClient(create_app(runtime=runtime), raise_server_exceptions=False)
    with client:
        response = client.post(
            "/internal/v1/knowledge/index",
            json=index_payload(),
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "EMBEDDING_PROFILE_MISCONFIGURED"
    assert error["retryable"] is False


def test_retrieve_deterministic_profile_on_pgvector_returns_500() -> None:
    # 检索侧同样前置拦截：一旦索引用真实 profile 写入，检索回落到
    # deterministic 会造成向量空间错乱且不报错，必须显式拒绝。
    settings = Settings(
        node_env="test", ai_internal_token="secret", ai_docs_enabled=False
    )
    runtime = AppRuntime(
        settings=settings,
        catalog=None,
        router=None,
        readiness_errors=[],
        embedding_router=build_default_embedding_router(),
        knowledge_store=object.__new__(PGVectorStoreGateway),
    )
    client = TestClient(create_app(runtime=runtime), raise_server_exceptions=False)
    with client:
        response = client.post(
            "/internal/v1/knowledge/retrieve",
            json=retrieve_payload(),
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "EMBEDDING_PROFILE_MISCONFIGURED"
    assert error["retryable"] is False


def test_delete_derived_index_over_http() -> None:
    client = build_knowledge_client()
    with client:
        index_response = client.post(
            "/internal/v1/knowledge/index",
            json=index_payload(),
            headers=TOKEN_HEADERS,
        )
        assert index_response.status_code == 200

        delete_response = client.post(
            "/internal/v1/knowledge/index/delete",
            json=delete_payload(),
            headers=TOKEN_HEADERS,
        )
        assert delete_response.status_code == 200
        body = delete_response.json()
        assert body["deleted_chunks"] == 1
        assert body["document_version_id"] == "docv-1"
        assert body["index_version"] == "idx-v1"

        retrieve_response = client.post(
            "/internal/v1/knowledge/retrieve",
            json=retrieve_payload(),
            headers=TOKEN_HEADERS,
        )
        assert retrieve_response.status_code == 200
        assert retrieve_response.json()["chunks"] == []


def test_delete_unknown_triple_returns_zero_chunks() -> None:
    client = build_knowledge_client()
    with client:
        response = client.post(
            "/internal/v1/knowledge/index/delete",
            json=delete_payload(),
            headers=TOKEN_HEADERS,
        )
    assert response.status_code == 200
    assert response.json()["deleted_chunks"] == 0
