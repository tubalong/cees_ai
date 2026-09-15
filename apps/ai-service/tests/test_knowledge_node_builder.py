from __future__ import annotations

from app.api.generated.models import (
    KnowledgeVisibilityScope,
    ParsedBlock,
    ParsedDocument,
    VisibilityScope,
)
from app.knowledge.node_builder import MAX_CHUNK_CHARS, IndexContext, build_nodes

DOC_ID = "doc-1"
VERSION_ID = "docv-1"


def make_block(
    order: int,
    block_type: str,
    text: str | None,
    *,
    heading_path: list[str] | None = None,
) -> ParsedBlock:
    return ParsedBlock(
        block_id=f"block-{order:05d}",
        type=block_type,
        text=text,
        heading_path=heading_path,
        source_order=order,
    )


def make_document(*blocks: ParsedBlock) -> ParsedDocument:
    return ParsedDocument(
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_name="mineru",
        parser_version="2.5.1",
        blocks=list(blocks) or [
            make_block(0, "paragraph", "占位内容"),
        ],
    )


def make_context(
    *,
    chunking_version: str = "chunk-v1",
    index_version: str = "idx-v1",
    visibility_scope: str = "TENANT",
    acl_version: str = "acl-1",
) -> IndexContext:
    return IndexContext(
        tenant_id="tenant-1",
        knowledge_base_id="kb-1",
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        chunking_version=chunking_version,
        embedding_profile="deterministic",
        index_version=index_version,
        visibility_scope=KnowledgeVisibilityScope(
            visibility_scope=VisibilityScope(visibility_scope),
            acl_version=acl_version,
        ),
    )


def test_short_paragraphs_merge_into_one_chunk() -> None:
    document = make_document(
        make_block(0, "paragraph", "第一段"),
        make_block(1, "paragraph", "第二段"),
    )
    nodes = build_nodes(document, make_context())
    assert len(nodes) == 1
    assert nodes[0].text == "第一段\n\n第二段"
    assert nodes[0].metadata["source_block_ids"] == ["block-00000", "block-00001"]


def test_chunk_splits_when_char_limit_exceeded() -> None:
    long_text = "长" * (MAX_CHUNK_CHARS + 1)
    document = make_document(
        make_block(0, "paragraph", long_text),
        make_block(1, "paragraph", "溢出段"),
    )
    nodes = build_nodes(document, make_context())
    assert len(nodes) == 2
    assert nodes[0].text == long_text
    assert nodes[1].text == "溢出段"


def test_atomic_blocks_are_never_merged() -> None:
    document = make_document(
        make_block(0, "paragraph", "前面的段落"),
        make_block(1, "table", "| a | b |"),
        make_block(2, "paragraph", "后面的段落"),
        make_block(3, "code_block", "x = 1"),
    )
    nodes = build_nodes(document, make_context())
    assert len(nodes) == 4
    assert nodes[1].text == "| a | b |"
    assert nodes[3].text == "x = 1"


def test_image_blocks_without_text_are_skipped() -> None:
    document = make_document(
        make_block(0, "paragraph", "正文"),
        make_block(1, "image", None),
        make_block(2, "caption", "图注"),
    )
    nodes = build_nodes(document, make_context())
    assert len(nodes) == 1
    assert "图注" in nodes[0].text


def test_chunking_is_deterministic_for_same_input() -> None:
    document = make_document(make_block(0, "paragraph", "稳定内容"))
    context = make_context()
    first = build_nodes(document, context)
    second = build_nodes(document, context)
    assert [node.id_ for node in first] == [node.id_ for node in second]
    assert first[0].id_ == second[0].id_


def test_chunk_id_changes_with_chunking_version() -> None:
    document = make_document(make_block(0, "paragraph", "稳定内容"))
    v1 = build_nodes(document, make_context(chunking_version="chunk-v1"))
    v2 = build_nodes(document, make_context(chunking_version="chunk-v2"))
    assert v1[0].id_ != v2[0].id_


def test_node_metadata_carries_identity_and_scope() -> None:
    document = make_document(
        make_block(0, "title", "标题", heading_path=["标题"]),
        make_block(1, "paragraph", "正文", heading_path=["标题"]),
    )
    nodes = build_nodes(document, make_context(index_version="idx-v7"))
    metadata = nodes[0].metadata
    assert metadata["tenant_id"] == "tenant-1"
    assert metadata["knowledge_base_id"] == "kb-1"
    assert metadata["document_id"] == DOC_ID
    assert metadata["document_version_id"] == VERSION_ID
    assert metadata["chunking_version"] == "chunk-v1"
    assert metadata["embedding_profile"] == "deterministic"
    assert metadata["index_version"] == "idx-v7"
    assert metadata["visibility_scope"] == "TENANT"
    assert metadata["acl_version"] == "acl-1"
    assert metadata["parser_name"] == "mineru"
    assert metadata["parser_version"] == "2.5.1"
    assert metadata["heading_path"] == ["标题"]
    assert metadata["chunk_id"] == nodes[0].id_


def test_chunk_order_follows_source_order() -> None:
    document = make_document(
        make_block(0, "paragraph", "甲" * (MAX_CHUNK_CHARS - 5)),
        make_block(1, "paragraph", "乙" * 6),
        make_block(2, "paragraph", "丙"),
    )
    nodes = build_nodes(document, make_context())
    assert [node.metadata["chunk_index"] for node in nodes] == [0, 1]
