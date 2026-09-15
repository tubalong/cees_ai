from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.runtime import AppRuntime
from app.embeddings.router import build_default_embedding_router
from app.knowledge.stores import InMemoryVectorStore
from app.main import create_app

TOKEN_HEADERS = {"X-AI-Internal-Token": "secret"}


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
