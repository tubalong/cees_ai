from __future__ import annotations

import hashlib
from dataclasses import dataclass

from llama_index.core.schema import TextNode

from app.api.generated.models import KnowledgeVisibilityScope, ParsedBlock, ParsedDocument
from app.knowledge.parsed_models import block_text

# 单块字符上限。切分只在块边界发生：表格、公式、代码块永远独立成
# chunk，其余相邻块累计到上限前合并，保持阅读顺序与章节上下文。
MAX_CHUNK_CHARS = 1200

# 这些块类型不可被合并拆散，各自独占一个 chunk。
_ATOMIC_BLOCK_TYPES = {"table", "formula", "code_block"}


@dataclass
class IndexContext:
    """一次索引请求携带的全部上下文，全部写入节点 metadata。"""

    tenant_id: str
    knowledge_base_id: str
    document_id: str
    document_version_id: str
    chunking_version: str
    embedding_profile: str
    index_version: str
    visibility_scope: KnowledgeVisibilityScope


def build_nodes(document: ParsedDocument, context: IndexContext) -> list[TextNode]:
    """把 ParsedDocument 切分为 LlamaIndex TextNode 列表。

    切分是确定性的：同一 ParsedDocument 与 IndexContext 永远产生相同
    chunk_id 序列，重复索引不会产生重复节点。图片等无文本块不参与索引。
    """
    nodes: list[TextNode] = []
    pending_blocks: list[ParsedBlock] = []
    pending_chars = 0

    def flush_pending() -> None:
        nonlocal pending_blocks, pending_chars
        if pending_blocks:
            nodes.append(_build_node(document, pending_blocks, context))
        pending_blocks = []
        pending_chars = 0

    for block in document.blocks:
        text = block_text(block)
        if not text:
            continue
        if block.type in _ATOMIC_BLOCK_TYPES:
            flush_pending()
            nodes.append(_build_node(document, [block], context))
            continue
        if pending_blocks and pending_chars + len(text) > MAX_CHUNK_CHARS:
            flush_pending()
        pending_blocks.append(block)
        pending_chars += len(text)

    flush_pending()
    return nodes


def _build_node(
    document: ParsedDocument, blocks: list[ParsedBlock], context: IndexContext
) -> TextNode:
    chunk_index = _next_chunk_index(blocks)
    chunk_id = _chunk_id(context.document_version_id, chunk_index, context.chunking_version)
    first = blocks[0]
    return TextNode(
        id_=chunk_id,
        text="\n\n".join(block_text(block) for block in blocks),
        metadata={
            "tenant_id": context.tenant_id,
            "knowledge_base_id": context.knowledge_base_id,
            "document_id": context.document_id,
            "document_version_id": context.document_version_id,
            "chunk_id": chunk_id,
            "chunk_index": chunk_index,
            "content_type": first.type.value,
            "page_index": first.page_index,
            "bbox": first.bbox,
            "heading_path": list(first.heading_path or []),
            "source_block_ids": [block.block_id for block in blocks],
            "source_orders": [block.source_order for block in blocks],
            "parser_name": document.parser_name,
            "parser_version": document.parser_version,
            "chunking_version": context.chunking_version,
            "embedding_profile": context.embedding_profile,
            "index_version": context.index_version,
            "visibility_scope": context.visibility_scope.visibility_scope.value,
            "department_id": context.visibility_scope.department_id,
            "project_id": context.visibility_scope.project_id,
            "acl_version": context.visibility_scope.acl_version,
        },
    )


def _next_chunk_index(blocks: list[ParsedBlock]) -> int:
    # 使用首个块的阅读顺序位置，保证同一文档内 chunk 顺序稳定。
    return blocks[0].source_order


def _chunk_id(document_version_id: str, chunk_index: int, chunking_version: str) -> str:
    digest = hashlib.sha256(
        f"{document_version_id}:{chunk_index}:{chunking_version}".encode()
    ).hexdigest()
    return digest[:16]
