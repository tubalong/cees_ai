"""文档规格清洗：去掉 LLM 生成稿里的「封面小节 / 标签前缀 / 占位行」。

LLM 在生成讲义、演示稿时经常：

- 额外插入一个「封面」小节，把标题、副标题、讲师、日期写成带标签的正文行；
- 用「标题：」「副标题：」这类标签做前缀；
- 留下「讲师：__________（占位）」等尚未填写的占位符。

这些内容与渲染器自动生成的封面重复，占位符又会被原样印在成稿上，是版式乱、
样式丑的主要来源（PPTX 里表现为一张写着「封面」的重复内容页，PDF 里表现为一个
「封面」标题后紧跟「标题：…」「副标题：…」「讲师：____（占位）」）。

本模块在 compose 落库与 PPTX/PDF/DOCX 渲染前统一清洗，保证三端行为一致。
清洗是幂等的：对已经清洗过的规格再次调用不会产生变化。
"""

from __future__ import annotations

from app.api.generated.models import (
    BulletListBlock,
    DocumentSection,
    DocumentSpec,
    NumberedListBlock,
    ParagraphBlock,
    PptxBulletListBlock,
    PptxNumberedListBlock,
    PptxParagraphBlock,
    PptxSlide,
    PptxSpec,
    QuoteBlock,
)
from app.documents.outline import is_placeholder_line as _is_placeholder
from app.documents.outline import (
    looks_like_cover,
    refine_cover,
    strip_label_prefix,
)

__all__ = ["normalize_document_spec", "normalize_pptx_spec"]


# --------------------------------------------------------------------------- #
# DocumentSpec（DOCX / PDF / 落库 Markdown 的事实源）
# --------------------------------------------------------------------------- #


def normalize_document_spec(document: DocumentSpec) -> DocumentSpec:
    """清洗 DocumentSpec：并入封面小节、剥离标签、剔除占位行与空块。"""
    subtitle = _clean_inline(document.subtitle) or None if document.subtitle else None
    sections: list[DocumentSection] = []
    cover_consumed = False

    for index, section in enumerate(document.sections):
        if index == 0 and not cover_consumed and _is_cover_section(section, document.title):
            cover = refine_cover(_section_lines(section), document_title=document.title)
            subtitle = subtitle or cover.subtitle
            cover_consumed = True
            continue
        cleaned = _clean_section(section)
        if cleaned is not None:
            sections.append(cleaned)

    if not sections:
        # 全部内容都被判为封面/占位（例如整篇只有一个封面小节）时，保留原文，
        # 避免产出没有正文的文档。
        sections = list(document.sections)

    return document.model_copy(update={"subtitle": subtitle, "sections": sections})


def _is_cover_section(section: DocumentSection, document_title: str) -> bool:
    return looks_like_cover(
        _section_lines(section),
        heading=section.heading,
        document_title=document_title,
    )


def _section_lines(section: DocumentSection) -> list[str]:
    lines: list[str] = []
    for block in section.blocks:
        if isinstance(block, ParagraphBlock):
            lines.append(block.text)
        elif isinstance(block, (BulletListBlock, NumberedListBlock)):
            lines.extend(block.items)
        elif isinstance(block, QuoteBlock):
            lines.append(block.text)
    return lines


def _clean_section(section: DocumentSection) -> DocumentSection | None:
    blocks: list = []
    for block in section.blocks:
        cleaned = _clean_document_block(block)
        if cleaned is not None:
            blocks.append(cleaned)
    if not blocks:
        return None
    if blocks == list(section.blocks):
        return section
    return section.model_copy(update={"blocks": blocks})


def _clean_document_block(block: object):
    if isinstance(block, ParagraphBlock):
        text = _clean_inline(block.text)
        if not text or _is_placeholder(text):
            return None
        return block if text == block.text else block.model_copy(update={"text": text})
    if isinstance(block, (BulletListBlock, NumberedListBlock)):
        items = _clean_items(block.items)
        if not items:
            return None
        return block if items == list(block.items) else block.model_copy(update={"items": items})
    return block


# --------------------------------------------------------------------------- #
# PptxSpec（PPTX 事实源）
# --------------------------------------------------------------------------- #


def normalize_pptx_spec(spec: PptxSpec) -> PptxSpec:
    """清洗 PptxSpec：并入封面页、剥离标签、剔除占位行与空块。"""
    subtitle = _clean_inline(spec.subtitle) or None if spec.subtitle else None
    slides: list[PptxSlide] = []
    cover_consumed = False

    for index, slide in enumerate(spec.slides):
        if index == 0 and not cover_consumed and _is_cover_slide(slide, spec.title):
            cover = refine_cover(_pptx_slide_lines(slide), document_title=spec.title)
            subtitle = subtitle or cover.subtitle
            cover_consumed = True
            continue
        cleaned = _clean_slide(slide)
        if cleaned is not None:
            slides.append(cleaned)

    if not slides:
        slides = list(spec.slides)

    return spec.model_copy(update={"subtitle": subtitle, "slides": slides})


def _is_cover_slide(slide: PptxSlide, document_title: str) -> bool:
    return looks_like_cover(
        _pptx_slide_lines(slide),
        heading=slide.title,
        document_title=document_title,
    )


def _pptx_slide_lines(slide: PptxSlide) -> list[str]:
    lines: list[str] = []
    for block in slide.blocks:
        if isinstance(block, PptxParagraphBlock):
            lines.append(block.text)
        elif isinstance(block, (PptxBulletListBlock, PptxNumberedListBlock)):
            lines.extend(block.items)
        elif isinstance(block, QuoteBlock):
            lines.append(block.text)
    return lines


def _clean_slide(slide: PptxSlide) -> PptxSlide | None:
    blocks: list = []
    for block in slide.blocks:
        cleaned = _clean_pptx_block(block)
        if cleaned is not None:
            blocks.append(cleaned)
    if not blocks:
        return None
    if blocks == list(slide.blocks):
        return slide
    return slide.model_copy(update={"blocks": blocks})


def _clean_pptx_block(block: object):
    if isinstance(block, PptxParagraphBlock):
        text = _clean_inline(block.text)
        if not text or _is_placeholder(text):
            return None
        return block if text == block.text else block.model_copy(update={"text": text})
    if isinstance(block, (PptxBulletListBlock, PptxNumberedListBlock)):
        items = _clean_items(block.items)
        if not items:
            return None
        return block if items == list(block.items) else block.model_copy(update={"items": items})
    if isinstance(block, QuoteBlock):
        text = _clean_inline(block.text)
        if not text or _is_placeholder(text):
            return None
        return block if text == block.text else block.model_copy(update={"text": text})
    return block


# --------------------------------------------------------------------------- #
# 共用文本清洗
# --------------------------------------------------------------------------- #


def _clean_items(items: list[str]) -> list[str]:
    cleaned: list[str] = []
    for item in items:
        value = _clean_inline(item)
        if not value or _is_placeholder(value):
            continue
        cleaned.append(value)
    return cleaned


def _clean_inline(value: str | None) -> str:
    if not value:
        return ""
    return strip_label_prefix(value).strip()
