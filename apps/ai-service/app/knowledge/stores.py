from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Protocol

from llama_index.core.schema import TextNode

from app.api.generated.models import KnowledgeRetrieveScope


class VectorStoreGateway(Protocol):
    """向量存储访问抽象。

    索引与检索只依赖本协议，具体后端（内存、pgvector 等）可替换。
    后端差异不进契约：删除按 (document_version_id, index_version) 过滤，
    检索必须支持租户与 scope 的 metadata 过滤。
    """

    async def upsert_nodes(
        self,
        *,
        tenant_id: str,
        document_version_id: str,
        index_version: str,
        nodes: list[TextNode],
    ) -> int:
        """幂等写入同一版本三元组下的全部节点，返回节点数。

        重复提交同一三元组必须替换旧节点而不是追加，否则会产生重复结果。
        """

    async def delete_document_version(
        self,
        *,
        tenant_id: str,
        document_version_id: str,
        index_version: str,
    ) -> int:
        """删除指定文档版本与索引版本的全部派生节点，返回删除数。"""

    async def retrieve(
        self,
        *,
        tenant_id: str,
        query_embedding: list[float],
        scope: KnowledgeRetrieveScope,
        index_version: str,
        top_k: int,
    ) -> list[ScoredNode]:
        """在向量检索阶段按 scope 过滤并返回 top-k。

        过滤发生在相似度排序之前：不满足 scope 或 index_version 的节点
        绝不进入候选。检索请求必须声明 index_version，避免旧代索引泄漏。
        """

    async def health_check(self) -> bool:
        """返回后端是否可用。"""


@dataclass
class ScoredNode:
    node: TextNode
    score: float


@dataclass
class InMemoryVectorStore:
    """进程内向量存储，仅用于开发与测试。

    数据按 (tenant_id, document_version_id, index_version) 三元组分桶，
    进程重启即丢失，不能作为生产存储。接口与 VectorStoreGateway 一致，
    后续替换为 pgvector 实现时不改调用方。
    """

    _buckets: dict[tuple[str, str, str], list[TextNode]] = field(default_factory=dict)

    async def upsert_nodes(
        self,
        *,
        tenant_id: str,
        document_version_id: str,
        index_version: str,
        nodes: list[TextNode],
    ) -> int:
        key = (tenant_id, document_version_id, index_version)
        self._buckets[key] = list(nodes)
        return len(nodes)

    async def delete_document_version(
        self,
        *,
        tenant_id: str,
        document_version_id: str,
        index_version: str,
    ) -> int:
        key = (tenant_id, document_version_id, index_version)
        removed = self._buckets.pop(key, [])
        return len(removed)

    async def retrieve(
        self,
        *,
        tenant_id: str,
        query_embedding: list[float],
        scope: KnowledgeRetrieveScope,
        index_version: str,
        top_k: int,
    ) -> list[ScoredNode]:
        candidates = self._filter_candidates(tenant_id, scope, index_version)
        scored = [
            ScoredNode(node=node, score=_cosine_similarity(query_embedding, embedding))
            for node, embedding in candidates
        ]
        scored.sort(key=lambda item: item.score, reverse=True)
        return scored[:top_k]

    async def health_check(self) -> bool:
        return True

    def _filter_candidates(
        self, tenant_id: str, scope: KnowledgeRetrieveScope, index_version: str
    ) -> list[tuple[TextNode, list[float]]]:
        # 内存实现没有持久化 embedding：嵌入向量存在节点自身，
        # ingestion 写入前会把向量赋给 node.embedding。
        candidates: list[tuple[TextNode, list[float]]] = []
        for (bucket_tenant, _version, bucket_index), nodes in self._buckets.items():
            if bucket_tenant != tenant_id or bucket_index != index_version:
                continue
            for node in nodes:
                if _matches_scope(node, scope) and node.embedding is not None:
                    candidates.append((node, node.embedding))
        return candidates


def _matches_scope(node: TextNode, scope: KnowledgeRetrieveScope) -> bool:
    metadata = node.metadata
    if metadata.get("knowledge_base_id") not in scope.knowledge_base_ids:
        return False
    if scope.allowed_document_ids is not None and (
        metadata.get("document_id") not in scope.allowed_document_ids
    ):
        return False
    if scope.department_ids is not None:
        department_id = metadata.get("department_id")
        if department_id is not None and department_id not in scope.department_ids:
            return False
    if scope.project_ids is not None:
        project_id = metadata.get("project_id")
        if project_id is not None and project_id not in scope.project_ids:
            return False
    # ACL 版本不一致说明节点索引时的可见范围已经陈旧，不能返回。
    if metadata.get("acl_version") != scope.acl_version:
        return False
    return True


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        raise ValueError("embedding dimension mismatch between query and node")
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)
