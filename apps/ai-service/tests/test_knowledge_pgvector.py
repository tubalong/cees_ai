from __future__ import annotations

import os
from pathlib import Path

import pytest
from llama_index.core.schema import NodeRelationship, RelatedNodeInfo, TextNode

from app.api.generated.models import KnowledgeRetrieveScope
from app.knowledge.pgvector_store import (
    PGVectorStoreGateway,
    _nullable_in_filter,
    _to_async_url,
    _version_filters,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TEST_TABLE = "test_knowledge_chunks"

TENANT = "tenant-pg"
VERSION_ID = "docv-pg-1"
INDEX_VERSION = "idx-pg-v1"


def make_node(
    *,
    node_id: str,
    text: str,
    embedding: list[float],
    **metadata: object,
) -> TextNode:
    defaults: dict[str, object] = {
        "tenant_id": TENANT,
        "knowledge_base_id": "kb-pg",
        "document_id": "doc-pg",
        "document_version_id": VERSION_ID,
        "chunk_id": node_id,
        "index_version": INDEX_VERSION,
        "acl_version": "acl-pg",
    }
    defaults.update(metadata)
    # PGVectorStore 写入时把顶层 metadata 的 document_id/doc_id/
    # ref_doc_id 覆盖为 node.ref_doc_id（从 relationships 的 SOURCE
    # 读取，构造参数 ref_doc_id 在 0.12.x 已被忽略）。显式设置 SOURCE
    # 关系，SQL 按 document_id 过滤才可靠。
    return TextNode(
        id_=node_id,
        relationships={
            NodeRelationship.SOURCE: RelatedNodeInfo(node_id=str(defaults["document_id"]))
        },
        text=text,
        embedding=embedding,
        metadata=defaults,
    )


def make_scope(
    *,
    knowledge_base_ids: list[str] | None = None,
    allowed_document_ids: list[str] | None = None,
    department_ids: list[str] | None = None,
    project_ids: list[str] | None = None,
    acl_version: str = "acl-pg",
) -> KnowledgeRetrieveScope:
    return KnowledgeRetrieveScope(
        knowledge_base_ids=knowledge_base_ids or ["kb-pg"],
        allowed_document_ids=allowed_document_ids,
        department_ids=department_ids,
        project_ids=project_ids,
        acl_version=acl_version,
    )


def vector_database_url() -> str | None:
    explicit = os.getenv("KNOWLEDGE_VECTOR_DATABASE_URL")
    if explicit:
        return explicit
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
            return url.rsplit("/", 1)[0] + "/cees_ai_vectors"
    return None


@pytest.fixture
def gateway() -> PGVectorStoreGateway:
    url = vector_database_url()
    if url is None:
        pytest.skip("KNOWLEDGE_VECTOR_DATABASE_URL or DATABASE_URL not configured")
    return PGVectorStoreGateway(url, embed_dim=4, table_name=TEST_TABLE)


@pytest.fixture
async def clean_gateway(gateway: PGVectorStoreGateway) -> PGVectorStoreGateway:
    await gateway._store.aclear()
    return gateway


# ---- 纯函数 ----

def test_to_async_url_converts_plain_postgres_url() -> None:
    assert _to_async_url("postgresql://user:pass@host:5432/db") == (
        "postgresql+asyncpg://user:pass@host:5432/db"
    )


def test_to_async_url_keeps_driver_prefixed_url() -> None:
    url = "postgresql+asyncpg://user:pass@host:5432/db"
    assert _to_async_url(url) == url


def test_version_filters_cover_identity_triple() -> None:
    filters = _version_filters(TENANT, VERSION_ID, INDEX_VERSION)
    assert len(filters.filters) == 3
    assert [f.key for f in filters.filters] == [
        "tenant_id",
        "document_version_id",
        "index_version",
    ]


def test_nullable_in_filter_combines_empty_and_list() -> None:
    filters = _nullable_in_filter("department_id", ["dept-a", "dept-b"])
    assert len(filters.filters) == 2
    empty_filter, in_filter = filters.filters
    assert empty_filter.operator.value == "is_empty"
    assert in_filter.operator.value == "in"
    assert in_filter.value == ["dept-a", "dept-b"]


def test_gateway_rejects_invalid_embed_dim() -> None:
    with pytest.raises(ValueError, match="embed_dim"):
        PGVectorStoreGateway("postgresql://x", embed_dim=0)


# ---- PG 集成：upsert/delete/filter/幂等/部分失败 ----


async def test_upsert_then_retrieve_and_delete(clean_gateway: PGVectorStoreGateway) -> None:
    gateway = clean_gateway
    node = make_node(
        node_id="n-1",
        text="项目延期需要升级到项目委员会。",
        embedding=[1.0, 0.0, 0.0, 0.0],
    )
    indexed = await gateway.upsert_nodes(
        tenant_id=TENANT,
        document_version_id=VERSION_ID,
        index_version=INDEX_VERSION,
        nodes=[node],
    )
    assert indexed == 1

    scored = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert len(scored) == 1
    assert scored[0].node.node_id == "n-1"
    assert scored[0].score > 0.9

    deleted = await gateway.delete_document_version(
        tenant_id=TENANT,
        document_version_id=VERSION_ID,
        index_version=INDEX_VERSION,
    )
    assert deleted == 1

    scored = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert scored == []


async def test_repeated_upsert_replaces_nodes(clean_gateway: PGVectorStoreGateway) -> None:
    gateway = clean_gateway
    first = make_node(
        node_id="n-1",
        text="第一版内容。",
        embedding=[1.0, 0.0, 0.0, 0.0],
    )
    await gateway.upsert_nodes(
        tenant_id=TENANT,
        document_version_id=VERSION_ID,
        index_version=INDEX_VERSION,
        nodes=[first],
    )
    second = make_node(
        node_id="n-2",
        text="第二版内容替换第一版。",
        embedding=[0.0, 1.0, 0.0, 0.0],
    )
    await gateway.upsert_nodes(
        tenant_id=TENANT,
        document_version_id=VERSION_ID,
        index_version=INDEX_VERSION,
        nodes=[second],
    )

    scored = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert [item.node.node_id for item in scored] == ["n-2"]


async def test_upsert_isolated_by_tenant_version_and_index(
    clean_gateway: PGVectorStoreGateway,
) -> None:
    gateway = clean_gateway
    node = make_node(node_id="n-1", text="内容", embedding=[1.0, 0.0, 0.0, 0.0])
    await gateway.upsert_nodes(
        tenant_id=TENANT,
        document_version_id=VERSION_ID,
        index_version=INDEX_VERSION,
        nodes=[node],
    )

    # 其他租户不可见
    other_tenant = await gateway.retrieve(
        tenant_id="tenant-other",
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=KnowledgeRetrieveScope(
            knowledge_base_ids=["kb-pg"], acl_version="acl-pg"
        ),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert other_tenant == []

    # 其他 index_version 不可见
    other_index = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(),
        index_version="idx-other",
        top_k=8,
    )
    assert other_index == []

    # 删除其他文档版本不影响本版本
    await gateway.delete_document_version(
        tenant_id=TENANT,
        document_version_id="docv-other",
        index_version=INDEX_VERSION,
    )
    scored = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert len(scored) == 1


async def test_scope_filters_apply_in_sql(
    clean_gateway: PGVectorStoreGateway,
) -> None:
    gateway = clean_gateway
    nodes = [
        make_node(
            node_id="n-1",
            text="知识库 A 的公开内容",
            embedding=[1.0, 0.0, 0.0, 0.0],
            knowledge_base_id="kb-a",
        ),
        make_node(
            node_id="n-2",
            text="知识库 B 的内容",
            embedding=[1.0, 0.0, 0.0, 0.0],
            knowledge_base_id="kb-b",
        ),
        make_node(
            node_id="n-3",
            text="部门受限内容",
            embedding=[1.0, 0.0, 0.0, 0.0],
            knowledge_base_id="kb-a",
            department_id="dept-a",
        ),
        make_node(
            node_id="n-4",
            text="旧 ACL 版本内容",
            embedding=[1.0, 0.0, 0.0, 0.0],
            knowledge_base_id="kb-a",
            acl_version="acl-old",
        ),
    ]
    await gateway.upsert_nodes(
        tenant_id=TENANT,
        document_version_id=VERSION_ID,
        index_version=INDEX_VERSION,
        nodes=nodes,
    )

    # 仅知识库 A + 当前 ACL：n-2 被 kb 过滤、n-4 被 acl 过滤，n-3 部门通过
    scored = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(knowledge_base_ids=["kb-a"]),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert {item.node.node_id for item in scored} == {"n-1", "n-3"}

    # 部门过滤：dept-a 内节点通过，其他部门节点被排除
    dept_scored = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(knowledge_base_ids=["kb-a"], department_ids=["dept-a"]),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert {item.node.node_id for item in dept_scored} == {"n-1", "n-3"}

    dept_scoped = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(knowledge_base_ids=["kb-a"], department_ids=["dept-x"]),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert {item.node.node_id for item in dept_scoped} == {"n-1"}

    # 文档 allowlist：只允许 n-3
    allowlist = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(
            knowledge_base_ids=["kb-a"],
            allowed_document_ids=["doc-pg"],
        ),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert {item.node.node_id for item in allowlist} == {"n-1", "n-3"}


async def test_upsert_dimension_mismatch_fails_before_delete(
    clean_gateway: PGVectorStoreGateway,
) -> None:
    gateway = clean_gateway
    valid = make_node(node_id="n-1", text="正常内容", embedding=[1.0, 0.0, 0.0, 0.0])
    await gateway.upsert_nodes(
        tenant_id=TENANT,
        document_version_id=VERSION_ID,
        index_version=INDEX_VERSION,
        nodes=[valid],
    )

    # 维度不符的节点在删除之前被拒绝，旧节点保持完好
    invalid = make_node(node_id="n-2", text="坏内容", embedding=[1.0, 0.0])
    with pytest.raises(ValueError, match="dimension"):
        await gateway.upsert_nodes(
            tenant_id=TENANT,
            document_version_id=VERSION_ID,
            index_version=INDEX_VERSION,
            nodes=[valid, invalid],
        )
    scored = await gateway.retrieve(
        tenant_id=TENANT,
        query_embedding=[1.0, 0.0, 0.0, 0.0],
        scope=make_scope(),
        index_version=INDEX_VERSION,
        top_k=8,
    )
    assert [item.node.node_id for item in scored] == ["n-1"]


async def test_delete_unknown_triple_returns_zero(
    clean_gateway: PGVectorStoreGateway,
) -> None:
    deleted = await clean_gateway.delete_document_version(
        tenant_id=TENANT,
        document_version_id="docv-missing",
        index_version=INDEX_VERSION,
    )
    assert deleted == 0


async def test_health_check(clean_gateway: PGVectorStoreGateway) -> None:
    assert await clean_gateway.health_check() is True
