from __future__ import annotations

import re

from app.api.generated.models import ParsedBlock, ParsedDocument

# 中间格式直接复用契约生成的模型：ParsedDocument 与 ParsedBlock 就是
# MinerU 原始产物与业务代码之间的隔离层，业务代码不依赖 MinerU JSON 结构。

_BLOCK_TYPES_WITH_TEXT = {
    "title",
    "paragraph",
    "list_item",
    "table",
    "formula",
    "code_block",
    "caption",
}

_WHITESPACE_PATTERN = re.compile(r"[ \t]+")
_NEWLINE_PATTERN = re.compile(r"\n{3,}")


def normalize_block_text(text: str) -> str:
    """把块内文本压缩为索引友好的形式。

    保留单个换行（列表、公式多行有意义），合并连续空行，压缩行内
    空白。标题、正文和表格单元格都走同一规则，保证索引文本稳定。
    """
    normalized = _NEWLINE_PATTERN.sub("\n\n", text.strip())
    return _WHITESPACE_PATTERN.sub(" ", normalized)


def block_text(block: ParsedBlock) -> str:
    """返回块用于索引的文本；纯资源块（如图片）返回空字符串。"""
    if block.type not in _BLOCK_TYPES_WITH_TEXT or not block.text:
        return ""
    return normalize_block_text(block.text)


def heading_of(block: ParsedBlock) -> str | None:
    """标题块返回其标题文本，其他块返回 None。"""
    if block.type != "title" or not block.text:
        return None
    return normalize_block_text(block.text)


def assert_identity_matches(
    document: ParsedDocument,
    *,
    document_id: str,
    document_version_id: str,
) -> None:
    """校验 ParsedDocument 身份与索引请求一致，防止串文档。"""
    if document.document_id != document_id:
        raise ValueError(
            f"parsed document id mismatch: expected {document_id}, "
            f"got {document.document_id}"
        )
    if document.document_version_id != document_version_id:
        raise ValueError(
            f"parsed document version mismatch: expected {document_version_id}, "
            f"got {document.document_version_id}"
        )
