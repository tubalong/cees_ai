from __future__ import annotations

import re
from typing import Any

from app.api.generated.models import ParsedBlock, ParsedDocument

# MinerU content_list.json 常见字段名；reader 只做宽松归一化，不追求
# 覆盖所有 MinerU 版本，未知类型统一回退为 paragraph。

_TYPE_MAPPING = {
    "text": "paragraph",
    "title": "title",
    "table": "table",
    "image": "image",
    "interline_equation": "formula",
    "inline_equation": "formula",
    "code": "code_block",
    "text_code": "code_block",
    "list": "list_item",
    "caption": "caption",
}

_HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
_HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+)$")
_CODE_FENCE_PATTERN = re.compile(r"^```")
_TABLE_ROW_PATTERN = re.compile(r"^\s*\|.*\|\s*$")


def from_content_list_json(
    payload: Any,
    *,
    document_id: str,
    document_version_id: str,
    parser_version: str,
) -> ParsedDocument:
    """把 MinerU content_list.json 宽松解析为 ParsedDocument。

    兼容顶层为 dict（含 pdf_info / content_list 键）或 list 两种形态；
    页码、bbox、标题层级字段名同时兼容 page_idx / page_index 等变体。
    """
    items = _extract_items(payload)
    blocks: list[ParsedBlock] = []
    heading_stack: list[str] = []
    for order, item in enumerate(items):
        blocks.extend(
            _item_to_blocks(item, order=order, heading_stack=heading_stack)
        )
    # 同一 MinerU 项可能派生出多个块（如图片与图注），统一重排保证
    # block_id 唯一、source_order 严格递增，避免 chunk 身份冲突。
    for index, block in enumerate(blocks):
        block.source_order = index
        block.block_id = f"block-{index:05d}"
    return ParsedDocument(
        document_id=document_id,
        document_version_id=document_version_id,
        parser_name="mineru",
        parser_version=parser_version,
        blocks=blocks,
    )


def from_markdown(
    markdown: str,
    *,
    document_id: str,
    document_version_id: str,
    parser_version: str,
) -> ParsedDocument:
    """把 Markdown 作为 fallback 解析为 ParsedDocument。

    用于没有 MinerU 解析产物的场景：标题、段落、围栏代码块和表格行
    会被识别，页码与 bbox 为空。
    """
    blocks: list[ParsedBlock] = []
    heading_stack: list[str] = []
    code_lines: list[str] = []
    table_lines: list[str] = []
    paragraph_lines: list[str] = []
    order = 0

    def flush_pending() -> None:
        nonlocal order
        if table_lines:
            blocks.append(
                _make_block(
                    order=order,
                    block_type="table",
                    text="\n".join(table_lines),
                    heading_path=list(heading_stack),
                )
            )
            table_lines.clear()
            order += 1
        if code_lines:
            blocks.append(
                _make_block(
                    order=order,
                    block_type="code_block",
                    text="\n".join(code_lines),
                    heading_path=list(heading_stack),
                )
            )
            code_lines.clear()
            order += 1
        if paragraph_lines:
            blocks.append(
                _make_block(
                    order=order,
                    block_type="paragraph",
                    text="\n".join(paragraph_lines),
                    heading_path=list(heading_stack),
                )
            )
            paragraph_lines.clear()
            order += 1

    in_fence = False
    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if _CODE_FENCE_PATTERN.match(line):
            # 围栏线切换代码块状态；fence 内的行（含空行）全部归入代码块。
            if paragraph_lines:
                flush_pending()
            in_fence = not in_fence
            continue
        if in_fence:
            code_lines.append(line)
            continue
        if not line.strip():
            flush_pending()
            continue
        if line.startswith("    "):
            # 缩进四空格同样是代码块；先结束前面的段落保持阅读顺序。
            if paragraph_lines:
                flush_pending()
            code_lines.append(line)
            continue
        if _TABLE_ROW_PATTERN.match(line):
            if paragraph_lines:
                flush_pending()
            table_lines.append(line.strip())
            continue
        heading_match = _HEADING_PATTERN.match(line)
        if heading_match:
            flush_pending()
            _update_heading_stack(
                heading_stack,
                level=len(heading_match.group(1)),
                title=heading_match.group(2).strip(),
            )
            blocks.append(
                _make_block(
                    order=order,
                    block_type="title",
                    text=heading_match.group(2).strip(),
                    heading_path=list(heading_stack),
                )
            )
            order += 1
            continue
        if not line.strip():
            flush_pending()
            continue
        paragraph_lines.append(line.strip())

    flush_pending()
    return ParsedDocument(
        document_id=document_id,
        document_version_id=document_version_id,
        parser_name="markdown",
        parser_version=parser_version,
        blocks=blocks,
    )


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        raise ValueError("content_list payload must be a list or an object")
    for key in ("pdf_info", "content_list", "blocks"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    raise ValueError("content_list payload has no item list")


def _item_to_blocks(
    item: dict[str, Any],
    *,
    order: int,
    heading_stack: list[str],
) -> list[ParsedBlock]:
    raw_type = str(item.get("type") or "text")
    block_type = _TYPE_MAPPING.get(raw_type, "paragraph")
    page_index = _page_index(item)
    bbox = _bbox(item)

    if block_type == "title":
        title = _plain_text(item)
        # 空标题块直接跳过，不污染标题栈；契约要求 text 非空或为 null。
        if not title:
            return []
        _update_heading_stack(heading_stack, level=_title_level(item), title=title)
        return [
            _make_block(
                order=order,
                block_type="title",
                text=title,
                page_index=page_index,
                bbox=bbox,
                heading_path=list(heading_stack),
            )
        ]

    blocks: list[ParsedBlock] = []
    if block_type == "image":
        asset_ref = item.get("img_path")
        if isinstance(asset_ref, str) and asset_ref.strip():
            blocks.append(
                _make_block(
                    order=order,
                    block_type="image",
                    text=None,
                    page_index=page_index,
                    bbox=bbox,
                    heading_path=list(heading_stack),
                    asset_ref=asset_ref.strip(),
                )
            )
        captions = _caption_texts(item)
        for caption in captions:
            blocks.append(
                _make_block(
                    order=order,
                    block_type="caption",
                    text=caption,
                    page_index=page_index,
                    bbox=bbox,
                    heading_path=list(heading_stack),
                )
            )
        return blocks

    text = _plain_text(item)
    if not text:
        # 无文本的普通块不参与索引，直接跳过，避免空 text 违反契约约束。
        return []
    return [
        _make_block(
            order=order,
            block_type=block_type,
            text=text,
            page_index=page_index,
            bbox=bbox,
            heading_path=list(heading_stack),
        )
    ]


def _make_block(
    *,
    order: int,
    block_type: str,
    text: str | None,
    page_index: int | None = None,
    bbox: list[float] | None = None,
    heading_path: list[str],
    asset_ref: str | None = None,
) -> ParsedBlock:
    return ParsedBlock(
        block_id=f"block-{order:05d}",
        type=block_type,
        text=text,
        page_index=page_index,
        bbox=bbox,
        heading_path=list(heading_path),
        source_order=order,
        asset_ref=asset_ref,
    )


def _update_heading_stack(
    heading_stack: list[str], *, level: int, title: str
) -> None:
    while heading_stack and len(heading_stack) >= level:
        heading_stack.pop()
    heading_stack.append(title)


def _title_level(item: dict[str, Any]) -> int:
    for key in ("text_level", "level"):
        value = item.get(key)
        if isinstance(value, int):
            return max(1, value)
    return 1


def _page_index(item: dict[str, Any]) -> int | None:
    for key in ("page_idx", "page_index", "page"):
        value = item.get(key)
        if isinstance(value, int):
            return max(0, value)
    return None


def _bbox(item: dict[str, Any]) -> list[float] | None:
    value = item.get("bbox")
    if isinstance(value, list) and len(value) == 4 and all(
        isinstance(number, int | float) for number in value
    ):
        return [float(number) for number in value]
    poly = item.get("poly")
    if isinstance(poly, list) and len(poly) == 8 and all(
        isinstance(number, int | float) for number in poly
    ):
        coordinates = [float(number) for number in poly]
        return [
            min(coordinates[0], coordinates[2], coordinates[4], coordinates[6]),
            min(coordinates[1], coordinates[3], coordinates[5], coordinates[7]),
            max(coordinates[0], coordinates[2], coordinates[4], coordinates[6]),
            max(coordinates[1], coordinates[3], coordinates[5], coordinates[7]),
        ]
    return None


def _caption_texts(item: dict[str, Any]) -> list[str]:
    captions: list[str] = []
    for key in ("img_caption", "table_caption", "caption"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            captions.append(value.strip())
        elif isinstance(value, list):
            for entry in value:
                if isinstance(entry, str) and entry.strip():
                    captions.append(entry.strip())
    return captions


def _plain_text(item: dict[str, Any]) -> str:
    text = item.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()
    table_body = item.get("table_body")
    if isinstance(table_body, str):
        # 相邻标签各产出一个空格，按任意空白分割后重新拼接，避免双空格。
        stripped = " ".join(_HTML_TAG_PATTERN.sub(" ", table_body).split())
        if stripped:
            return stripped
    return ""
