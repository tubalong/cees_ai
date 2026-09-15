from __future__ import annotations

from app.api.generated.models import (
    KnowledgeIndexDeleteRequest,
    KnowledgeIndexDeleteResponse,
)
from app.knowledge.stores import VectorStoreGateway


async def delete_document_index(
    request: KnowledgeIndexDeleteRequest,
    *,
    store: VectorStoreGateway,
) -> KnowledgeIndexDeleteResponse:
    """删除文档版本的派生索引，不影响业务数据。

    按 (tenant_id, document_version_id, index_version) 过滤删除全部
    派生节点；不存在的三元组返回 0。删除是幂等的，可安全重试。
    """
    deleted = await store.delete_document_version(
        tenant_id=request.tenant_id,
        document_version_id=request.document_version_id,
        index_version=request.index_version,
    )
    return KnowledgeIndexDeleteResponse(
        request_id=request.request_id,
        deleted_chunks=deleted,
        document_version_id=request.document_version_id,
        index_version=request.index_version,
    )
