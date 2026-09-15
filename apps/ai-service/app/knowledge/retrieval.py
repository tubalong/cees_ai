from __future__ import annotations

from app.api.generated.models import (
    KnowledgeRetrieveRequest,
    KnowledgeRetrieveResponse,
    RetrievedChunk,
)
from app.embeddings.router import EmbeddingRouter
from app.knowledge.stores import ScoredNode, VectorStoreGateway


async def retrieve_chunks(
    request: KnowledgeRetrieveRequest,
    *,
    store: VectorStoreGateway,
    embedding_router: EmbeddingRouter,
) -> KnowledgeRetrieveResponse:
    """按可信 scope 检索知识库节点。

    scope 由调用方（NestJS）基于身份与权限计算，ai-service 不推断
    权限，只在向量检索阶段应用过滤。检索不调用 LLM。
    """
    query_embedding = await embedding_router.embed_query(
        request.embedding_profile, request.query
    )
    scored = await store.retrieve(
        tenant_id=request.tenant_id,
        query_embedding=query_embedding,
        scope=request.scope,
        index_version=request.index_version,
        top_k=request.top_k or 8,
    )
    return KnowledgeRetrieveResponse(
        request_id=request.request_id,
        chunks=[_to_retrieved_chunk(item) for item in scored],
        index_version=request.index_version,
        embedding_profile=embedding_router.resolve_name(request.embedding_profile),
    )


def _to_retrieved_chunk(scored: ScoredNode) -> RetrievedChunk:
    metadata = scored.node.metadata
    return RetrievedChunk(
        chunk_id=str(metadata["chunk_id"]),
        document_id=str(metadata["document_id"]),
        document_version_id=str(metadata["document_version_id"]),
        text=scored.node.text,
        score=scored.score,
        page_index=metadata.get("page_index"),
        bbox=metadata.get("bbox"),
        heading_path=list(metadata.get("heading_path") or []),
    )
