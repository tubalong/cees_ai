from __future__ import annotations

import time

from llama_index.core.schema import TextNode

from app.api.generated.models import (
    KnowledgeIndexRequest,
    KnowledgeIndexResponse,
)
from app.embeddings.router import EmbeddingRouter
from app.knowledge.node_builder import IndexContext, build_nodes
from app.knowledge.parsed_models import assert_identity_matches
from app.knowledge.stores import VectorStoreGateway


async def index_document(
    request: KnowledgeIndexRequest,
    *,
    store: VectorStoreGateway,
    embedding_router: EmbeddingRouter,
) -> KnowledgeIndexResponse:
    """索引一个解析后的知识文档，幂等四元组为索引身份。

    步骤：身份校验 -> 节点构建（切分 v1）-> Embedding -> 幂等写入。
    同一四元组重复提交会替换旧节点，不会产生重复向量。
    """
    started_at = time.monotonic()
    document = request.parsed_document
    assert_identity_matches(
        document,
        document_id=request.document_id,
        document_version_id=request.document_version_id,
    )

    context = IndexContext(
        tenant_id=request.tenant_id,
        knowledge_base_id=request.knowledge_base_id,
        document_id=request.document_id,
        document_version_id=request.document_version_id,
        chunking_version=request.chunking_version,
        embedding_profile=request.embedding_profile,
        index_version=request.index_version,
        visibility_scope=request.visibility_scope,
    )
    nodes = build_nodes(document, context)
    if not nodes:
        raise ValueError("document contains no indexable text blocks")

    vectors = await embedding_router.embed_documents(
        request.embedding_profile, [node.text for node in nodes]
    )
    embedded_nodes: list[TextNode] = []
    for node, vector in zip(nodes, vectors, strict=True):
        node.embedding = vector
        embedded_nodes.append(node)

    indexed = await store.upsert_nodes(
        tenant_id=request.tenant_id,
        document_version_id=request.document_version_id,
        index_version=request.index_version,
        nodes=embedded_nodes,
    )
    return KnowledgeIndexResponse(
        request_id=request.request_id,
        indexed_chunks=indexed,
        chunking_version=request.chunking_version,
        embedding_profile=embedding_router.resolve_name(request.embedding_profile),
        index_version=request.index_version,
        latency_ms=int((time.monotonic() - started_at) * 1000),
    )
