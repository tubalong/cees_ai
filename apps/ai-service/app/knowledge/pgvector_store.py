from __future__ import annotations

from llama_index.core.schema import TextNode
from llama_index.core.vector_stores.types import (
    FilterCondition,
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
    VectorStoreQuery,
)
from llama_index.vector_stores.postgres import PGVectorStore
from sqlalchemy import and_, text

from app.api.generated.models import KnowledgeRetrieveScope
from app.knowledge.stores import ScoredNode

# 向量表名。schema 由 ai-service 自行管理（不进 Prisma），首次使用时
# PGVectorStore 会建表并启用 vector 扩展。
VECTOR_TABLE_NAME = "knowledge_chunks"


class PGVectorStoreGateway:
    """LlamaIndex PGVectorStore 的薄适配，实现 VectorStoreGateway。

    连接独立 `cees_ai_vectors` database，不接触业务库。节点 metadata
    存 JSONB，租户/scope/index_version 过滤在 SQL WHERE 层完成，与
    排序在同一个查询内执行（过滤先于 top-k）。

    幂等语义：`upsert_nodes` 采用「先写新后删旧」——新节点先落地，
    再删除三元组内的全部旧行（含同 node_id 的旧内容行与本次集合外
    的废弃行）。重复提交同一三元组是替换而非追加，读请求只见全旧
    或全新，不存在先删后写的中间态空桶窗口。add 失败时旧行原样
    保留；清理失败时最坏出现重复行，按幂等语义重试后收敛，最终
    一致。
    """

    def __init__(
        self,
        database_url: str,
        *,
        embed_dim: int,
        table_name: str = VECTOR_TABLE_NAME,
    ) -> None:
        if embed_dim <= 0:
            raise ValueError("embed_dim must be a positive integer")
        self._embed_dim = embed_dim
        self._store = PGVectorStore.from_params(
            connection_string=database_url,
            async_connection_string=_to_async_url(database_url),
            table_name=table_name,
            embed_dim=embed_dim,
            use_jsonb=True,
            create_engine_kwargs={"pool_pre_ping": True},
        )

    async def upsert_nodes(
        self,
        *,
        tenant_id: str,
        document_version_id: str,
        index_version: str,
        nodes: list[TextNode],
    ) -> int:
        if not nodes:
            return 0
        self._assert_embedding_dimensions(nodes)
        self._store._initialize()
        # 先写新后删旧：新节点先落地，读请求只见全旧或全新，
        # 不存在先删后写的空桶中间态窗口。
        await self._store.async_add(nodes)
        await self._delete_stale_nodes(
            tenant_id=tenant_id,
            document_version_id=document_version_id,
            index_version=index_version,
            keep_node_ids={node.node_id for node in nodes},
        )
        return len(nodes)

    async def _delete_stale_nodes(
        self,
        *,
        tenant_id: str,
        document_version_id: str,
        index_version: str,
        keep_node_ids: set[str],
    ) -> None:
        """删除三元组内除本次写入的最新行外的全部旧行。

        PGVectorStore 的 node_id 无唯一约束，async_add 对相同 node_id
        只会追加新行（自增 id 递增）。本方法保留三元组内每个 node_id
        的 id 最大行（即本次写入的新行），删除其余旧行：同 node_id 的
        旧内容行，以及不在本次节点集合中的废弃行。
        """
        from sqlalchemy import delete, func, select

        table = self._store._table_class
        metadata_ = table.metadata_
        triple = and_(
            metadata_["tenant_id"].astext == tenant_id,
            metadata_["document_version_id"].astext == document_version_id,
            metadata_["index_version"].astext == index_version,
        )
        keep_rows = (
            select(func.max(table.id))
            .where(triple, table.node_id.in_(keep_node_ids))
            .group_by(table.node_id)
        )
        stmt = delete(table).where(triple, table.id.not_in(keep_rows))
        async with self._store._async_session() as session, session.begin():
            await session.execute(stmt)

    async def delete_document_version(
        self,
        *,
        tenant_id: str,
        document_version_id: str,
        index_version: str,
    ) -> int:
        filters = _version_filters(tenant_id, document_version_id, index_version)
        existing = await self._store.aget_nodes(filters=filters)
        if not existing:
            return 0
        await self._store.adelete_nodes(node_ids=[node.node_id for node in existing])
        return len(existing)

    async def retrieve(
        self,
        *,
        tenant_id: str,
        query_embedding: list[float],
        scope: KnowledgeRetrieveScope,
        index_version: str,
        top_k: int,
    ) -> list[ScoredNode]:
        query = VectorStoreQuery(
            query_embedding=query_embedding,
            similarity_top_k=top_k,
            filters=_retrieve_filters(tenant_id, scope, index_version),
        )
        result = await self._store.aquery(query)
        return [
            ScoredNode(node=node, score=score)
            for node, score in zip(result.nodes, result.similarities, strict=True)
        ]

    async def health_check(self) -> bool:
        try:
            self._store._initialize()
            async with self._store._async_engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except Exception:
            return False
        return True

    def _assert_embedding_dimensions(self, nodes: list[TextNode]) -> None:
        for node in nodes:
            embedding = node.get_embedding()
            if embedding is None or len(embedding) != self._embed_dim:
                raise ValueError(
                    f"node {node.node_id} embedding dimension does not match "
                    f"vector table dimension {self._embed_dim}"
                )


def _to_async_url(database_url: str) -> str:
    """postgresql:// → postgresql+asyncpg://；已带驱动前缀则原样返回。"""
    if database_url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + database_url[len("postgresql://") :]
    return database_url


def _version_filters(
    tenant_id: str, document_version_id: str, index_version: str
) -> MetadataFilters:
    """(tenant, document_version, index_version) 三元组过滤，删除与幂等写入共用。"""
    return MetadataFilters(
        filters=[
            MetadataFilter(key="tenant_id", value=tenant_id, operator=FilterOperator.EQ),
            MetadataFilter(
                key="document_version_id",
                value=document_version_id,
                operator=FilterOperator.EQ,
            ),
            MetadataFilter(key="index_version", value=index_version, operator=FilterOperator.EQ),
        ]
    )


def _retrieve_filters(
    tenant_id: str, scope: KnowledgeRetrieveScope, index_version: str
) -> MetadataFilters:
    """按可信 scope 构造检索过滤。

    语义与内存实现的 `_matches_scope` 一致：租户与 index_version 必须
    匹配；knowledge_base 必须在列表内；allowed_document_ids 提供时文档
    必须在其内；department/project 过滤只约束携带该属性的节点（IS NULL
    视为通过）；ACL 版本仅在调用方提供时过滤。过滤全部下推到 SQL WHERE。
    """
    filters: list[MetadataFilters | MetadataFilter] = [
        MetadataFilter(key="tenant_id", value=tenant_id, operator=FilterOperator.EQ),
        MetadataFilter(key="index_version", value=index_version, operator=FilterOperator.EQ),
        MetadataFilter(
            key="knowledge_base_id",
            value=scope.knowledge_base_ids,
            operator=FilterOperator.IN,
        ),
    ]
    if scope.allowed_document_ids is not None:
        filters.append(
            MetadataFilter(
                key="document_id",
                value=scope.allowed_document_ids,
                operator=FilterOperator.IN,
            )
        )
    if scope.department_ids is not None:
        filters.append(_nullable_in_filter("department_id", scope.department_ids))
    if scope.project_ids is not None:
        filters.append(_nullable_in_filter("project_id", scope.project_ids))
    if scope.acl_version is not None:
        filters.append(
            MetadataFilter(key="acl_version", value=scope.acl_version, operator=FilterOperator.EQ)
        )
    return MetadataFilters(filters=filters)


def _nullable_in_filter(key: str, allowed: list[str]) -> MetadataFilters:
    """department/project 等可空属性：值为空或命中允许列表都通过。"""
    return MetadataFilters(
        condition=FilterCondition.OR,
        filters=[
            MetadataFilter(key=key, value=None, operator=FilterOperator.IS_EMPTY),
            MetadataFilter(key=key, value=allowed, operator=FilterOperator.IN),
        ],
    )
