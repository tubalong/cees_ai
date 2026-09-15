from __future__ import annotations

import pytest

from app.api.generated.models import (
    KnowledgeIndexRequest,
    KnowledgeRetrieveRequest,
    KnowledgeRetrieveScope,
    KnowledgeVisibilityScope,
    ParsedBlock,
    ParsedDocument,
    VisibilityScope,
)
from app.embeddings.router import build_default_embedding_router
from app.knowledge.ingestion import index_document
from app.knowledge.retrieval import retrieve_chunks
from app.knowledge.stores import InMemoryVectorStore

DOC_ID = "doc-1"
VERSION_ID = "docv-1"


def make_parsed_document(
    text: str,
    *,
    document_id: str = DOC_ID,
    document_version_id: str = VERSION_ID,
) -> ParsedDocument:
    return ParsedDocument(
        document_id=document_id,
        document_version_id=document_version_id,
        parser_name="mineru",
        parser_version="2.5.1",
        blocks=[
            ParsedBlock(
                block_id="block-00000",
                type="paragraph",
                text=text,
                source_order=0,
            )
        ],
    )


def make_index_request(
    *,
    tenant_id: str = "tenant-1",
    knowledge_base_id: str = "kb-1",
    document_id: str = DOC_ID,
    document_version_id: str = VERSION_ID,
    index_version: str = "idx-v1",
    text: str = "项目延期超过两周时需要升级到项目委员会。",
    visibility_scope: KnowledgeVisibilityScope | None = None,
) -> KnowledgeIndexRequest:
    scope = visibility_scope or KnowledgeVisibilityScope(
        visibility_scope=VisibilityScope.TENANT,
        acl_version="acl-1",
    )
    return KnowledgeIndexRequest(
        request_id="req-index-1",
        tenant_id=tenant_id,
        user_id="user-1",
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        document_version_id=document_version_id,
        parsed_document=make_parsed_document(
            text, document_id=document_id, document_version_id=document_version_id
        ),
        chunking_version="chunk-v1",
        embedding_profile="deterministic",
        index_version=index_version,
        visibility_scope=scope,
    )


def make_retrieve_request(
    *,
    query: str,
    tenant_id: str = "tenant-1",
    knowledge_base_ids: list[str] | None = None,
    allowed_document_ids: list[str] | None = None,
    department_ids: list[str] | None = None,
    project_ids: list[str] | None = None,
    acl_version: str = "acl-1",
    index_version: str = "idx-v1",
    top_k: int = 8,
) -> KnowledgeRetrieveRequest:
    return KnowledgeRetrieveRequest(
        request_id="req-retrieve-1",
        tenant_id=tenant_id,
        user_id="user-1",
        query=query,
        scope=KnowledgeRetrieveScope(
            knowledge_base_ids=knowledge_base_ids or ["kb-1"],
            allowed_document_ids=allowed_document_ids,
            department_ids=department_ids,
            project_ids=project_ids,
            acl_version=acl_version,
        ),
        top_k=top_k,
        index_version=index_version,
        embedding_profile=None,
    )


async def test_index_then_retrieve_round_trip() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    result = await index_document(make_index_request(), store=store, embedding_router=router)
    assert result.indexed_chunks == 1
    assert result.chunking_version == "chunk-v1"
    assert result.embedding_profile == "deterministic"
    assert result.index_version == "idx-v1"
    assert result.latency_ms is not None

    response = await retrieve_chunks(
        make_retrieve_request(query="项目延期超过两周"),
        store=store,
        embedding_router=router,
    )
    assert response.index_version == "idx-v1"
    assert response.embedding_profile == "deterministic"
    assert len(response.chunks) == 1
    chunk = response.chunks[0]
    assert chunk.document_id == DOC_ID
    assert chunk.document_version_id == VERSION_ID
    assert chunk.chunk_id
    assert chunk.score > 0.5


async def test_repeated_index_same_quadruple_does_not_duplicate() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    request = make_index_request()
    await index_document(request, store=store, embedding_router=router)
    await index_document(request, store=store, embedding_router=router)

    response = await retrieve_chunks(
        make_retrieve_request(query="项目延期超过两周"),
        store=store,
        embedding_router=router,
    )
    assert len(response.chunks) == 1
    buckets = store._buckets
    key = ("tenant-1", VERSION_ID, "idx-v1")
    assert len(buckets[key]) == 1


async def test_tenant_isolation() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    await index_document(
        make_index_request(tenant_id="tenant-a"),
        store=store,
        embedding_router=router,
    )
    response = await retrieve_chunks(
        make_retrieve_request(query="项目延期", tenant_id="tenant-b"),
        store=store,
        embedding_router=router,
    )
    assert response.chunks == []


async def test_knowledge_base_scope_filters_nodes() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    await index_document(
        make_index_request(knowledge_base_id="kb-1"),
        store=store,
        embedding_router=router,
    )
    response = await retrieve_chunks(
        make_retrieve_request(query="项目延期", knowledge_base_ids=["kb-other"]),
        store=store,
        embedding_router=router,
    )
    assert response.chunks == []


async def test_allowed_document_ids_filters_nodes() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    await index_document(make_index_request(), store=store, embedding_router=router)
    response = await retrieve_chunks(
        make_retrieve_request(
            query="项目延期", allowed_document_ids=["doc-other"]
        ),
        store=store,
        embedding_router=router,
    )
    assert response.chunks == []


async def test_department_and_project_scope_filters_nodes() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    scoped = KnowledgeVisibilityScope(
        visibility_scope=VisibilityScope.DEPARTMENT,
        department_id="dept-2",
        project_id="project-3",
        acl_version="acl-1",
    )
    await index_document(
        make_index_request(visibility_scope=scoped),
        store=store,
        embedding_router=router,
    )
    # 部门不在允许列表 -> 过滤
    blocked = await retrieve_chunks(
        make_retrieve_request(query="项目延期", department_ids=["dept-1"]),
        store=store,
        embedding_router=router,
    )
    assert blocked.chunks == []
    # 部门在允许列表、项目不在 -> 仍过滤
    blocked_by_project = await retrieve_chunks(
        make_retrieve_request(
            query="项目延期", department_ids=["dept-2"], project_ids=["project-9"]
        ),
        store=store,
        embedding_router=router,
    )
    assert blocked_by_project.chunks == []
    # 部门与项目都匹配 -> 通过
    allowed = await retrieve_chunks(
        make_retrieve_request(
            query="项目延期", department_ids=["dept-2"], project_ids=["project-3"]
        ),
        store=store,
        embedding_router=router,
    )
    assert len(allowed.chunks) == 1


async def test_stale_acl_version_never_served() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    await index_document(make_index_request(), store=store, embedding_router=router)
    response = await retrieve_chunks(
        make_retrieve_request(query="项目延期", acl_version="acl-stale"),
        store=store,
        embedding_router=router,
    )
    assert response.chunks == []


async def test_retrieve_only_sees_declared_index_version() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    await index_document(
        make_index_request(index_version="idx-v1", text="版本一的旧内容"),
        store=store,
        embedding_router=router,
    )
    await index_document(
        make_index_request(index_version="idx-v2", text="版本二的新内容"),
        store=store,
        embedding_router=router,
    )
    old = await retrieve_chunks(
        make_retrieve_request(query="内容", index_version="idx-v1"),
        store=store,
        embedding_router=router,
    )
    assert len(old.chunks) == 1
    assert old.chunks[0].text == "版本一的旧内容"
    new = await retrieve_chunks(
        make_retrieve_request(query="内容", index_version="idx-v2"),
        store=store,
        embedding_router=router,
    )
    assert len(new.chunks) == 1
    assert new.chunks[0].text == "版本二的新内容"


async def test_document_version_deletion_removes_only_that_version() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    await index_document(
        make_index_request(document_version_id="docv-1", text="第一版内容"),
        store=store,
        embedding_router=router,
    )
    await index_document(
        make_index_request(document_version_id="docv-2", text="第二版内容"),
        store=store,
        embedding_router=router,
    )
    removed = await store.delete_document_version(
        tenant_id="tenant-1", document_version_id="docv-1", index_version="idx-v1"
    )
    assert removed == 1
    remaining = await retrieve_chunks(
        make_retrieve_request(query="内容"),
        store=store,
        embedding_router=router,
    )
    assert len(remaining.chunks) == 1
    assert remaining.chunks[0].document_version_id == "docv-2"


async def test_top_k_truncates_results() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    for index in range(3):
        await index_document(
            make_index_request(
                document_id=f"doc-{index}",
                document_version_id=f"docv-{index}",
                index_version="idx-v1",
                text=f"关于项目延期的规定第{index}条",
            ),
            store=store,
            embedding_router=router,
        )
    response = await retrieve_chunks(
        make_retrieve_request(query="项目延期", top_k=2),
        store=store,
        embedding_router=router,
    )
    assert len(response.chunks) == 2


async def test_index_rejects_document_without_indexable_text() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    request = make_index_request()
    request.parsed_document.blocks = [
        ParsedBlock(block_id="block-img", type="image", text=None, source_order=0)
    ]
    with pytest.raises(ValueError, match="no indexable text"):
        await index_document(request, store=store, embedding_router=router)


async def test_index_rejects_identity_mismatch() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    request = make_index_request()
    # 只改请求侧 document_id，使其与 parsed_document 携带的身份不一致。
    request.document_id = "doc-expected"
    with pytest.raises(ValueError, match="document id mismatch"):
        await index_document(request, store=store, embedding_router=router)


async def test_unknown_embedding_profile_raises() -> None:
    store = InMemoryVectorStore()
    router = build_default_embedding_router()
    request = make_index_request()
    request.embedding_profile = "nonexistent"
    with pytest.raises(KeyError, match="unknown embedding profile"):
        await index_document(request, store=store, embedding_router=router)
