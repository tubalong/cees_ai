from __future__ import annotations

from app.core.errors import AIServiceError
from app.embeddings.router import EmbeddingRouter
from app.knowledge.pgvector_store import PGVectorStoreGateway
from app.knowledge.stores import VectorStoreGateway


def assert_compatible_vector_space(
    store: VectorStoreGateway,
    *,
    embedding_router: EmbeddingRouter,
    profile_name: str | None,
    request_id: str,
) -> None:
    """校验向量库与 embedding profile 的空间一致性，索引与检索共用。

    pgvector 表维度在建表时固定（KNOWLEDGE_VECTOR_DIMENSION），而内置
    deterministic provider 是 384 维开发用哈希向量：维度不一致时会在
    upsert 阶段报错，维度碰巧一致时索引与检索的向量空间错乱且不报错
    （比显式失败更危险）。因此持久化向量库直接拒绝 deterministic，
    前置拦截为明确的配置错误（retryable=False），提示启用外部
    OpenAI-compatible profile。

    内存向量库不受约束：向量随节点存储，检索仅在节点自身 embedding
    上计算，开发与测试场景下 deterministic 仍然合法。
    """
    if not isinstance(store, PGVectorStoreGateway):
        return
    if embedding_router.is_deterministic(profile_name):
        raise AIServiceError(
            "EMBEDDING_PROFILE_MISCONFIGURED",
            "pgvector vector store does not support the built-in deterministic "
            "embedding profile: enable an OpenAI-compatible embedding profile "
            "and configure index/retrieve to use it",
            status_code=500,
            retryable=False,
            request_id=request_id,
        )
