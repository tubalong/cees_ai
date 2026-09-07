from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO
from typing import Any
from urllib.parse import quote

from docx import Document as WordDocument
from docx.document import Document as DocxDocument
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from app.api.generated.models import (
    BulletListBlock,
    DocumentOptions,
    DocumentSpec,
    NumberedListBlock,
    PageBreakBlock,
    ParagraphBlock,
    QuoteBlock,
    TableBlock,
    TemplateId,
)
from app.documents.validation import validate_document_spec

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_INVALID_FILENAME = re.compile(r'[\x00-\x1f<>:"/\\|?*]+')


@dataclass(frozen=True)
class RenderedDocx:
    content: bytes
    filename: str


class DocxRenderer:
    def render(
        self,
        document: DocumentSpec,
        options: DocumentOptions,
        *,
        request_id: str,
    ) -> RenderedDocx:
        validate_document_spec(document, request_id=request_id, status_code=422)
        template_id = options.template_id or TemplateId.business_standard
        if template_id != TemplateId.business_standard:
            raise ValueError(f"unsupported document template: {template_id}")

        locale = options.locale or "zh-CN"
        word_document = WordDocument()
        _configure_document(word_document, locale)
        word_document.core_properties.title = document.title
        word_document.core_properties.language = locale
        word_document.add_heading(document.title, level=0)
        if document.subtitle:
            subtitle = word_document.add_paragraph(style="Subtitle")
            subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
            subtitle.add_run(document.subtitle)
        if options.include_toc:
            _add_table_of_contents(word_document, locale)

        for section in document.sections:
            word_document.add_heading(section.heading, level=section.level)
            for block in section.blocks:
                if isinstance(block, ParagraphBlock):
                    word_document.add_paragraph(block.text)
                elif isinstance(block, BulletListBlock):
                    for item in block.items:
                        word_document.add_paragraph(item, style="List Bullet")
                elif isinstance(block, NumberedListBlock):
                    for item in block.items:
                        word_document.add_paragraph(item, style="List Number")
                elif isinstance(block, TableBlock):
                    _add_table(word_document, block)
                elif isinstance(block, QuoteBlock):
                    quote_paragraph = word_document.add_paragraph(block.text, style="Quote")
                    if block.attribution:
                        attribution = word_document.add_paragraph()
                        attribution.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                        attribution.add_run(block.attribution).italic = True
                    quote_paragraph.paragraph_format.keep_together = True
                elif isinstance(block, PageBreakBlock):
                    word_document.add_page_break()

        _add_page_numbers(word_document, locale)
        output = BytesIO()
        word_document.save(output)
        return RenderedDocx(
            content=output.getvalue(),
            filename=_safe_filename(document.title),
        )


def content_disposition(filename: str) -> str:
    encoded_filename = quote(filename, safe="")
    return f"attachment; filename=\"document.docx\"; filename*=UTF-8''{encoded_filename}"


def _configure_document(document: DocxDocument, locale: str) -> None:
    is_chinese = locale.lower().startswith("zh")
    body_font = "SimSun" if is_chinese else "Aptos"
    heading_font = "Microsoft YaHei" if is_chinese else "Aptos Display"

    for section in document.sections:
        section.page_width = Cm(21)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(3.18)
        section.right_margin = Cm(3.18)

    normal = document.styles["Normal"]
    _set_style_font(normal, body_font, 10.5)
    normal.paragraph_format.line_spacing = 1.5
    normal.paragraph_format.space_after = Pt(6)

    heading_styles = (
        ("Title", 22),
        ("Subtitle", 12),
        ("Heading 1", 16),
        ("Heading 2", 14),
        ("Heading 3", 12),
    )
    for style_name, size in heading_styles:
        _set_style_font(document.styles[style_name], heading_font, size)


def _set_style_font(style: Any, font_name: str, size: float) -> None:
    style.font.name = font_name
    style.font.size = Pt(size)
    style._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), font_name)


def _add_table(document: DocxDocument, block: TableBlock) -> None:
    table = document.add_table(rows=1, cols=len(block.columns))
    table.style = "Table Grid"
    for index, column in enumerate(block.columns):
        run = table.rows[0].cells[index].paragraphs[0].add_run(column)
        run.bold = True
    for values in block.rows:
        cells = table.add_row().cells
        for index, value in enumerate(values):
            cells[index].text = value


def _add_table_of_contents(document: DocxDocument, locale: str) -> None:
    heading = document.add_paragraph()
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    heading.add_run("目录" if locale.lower().startswith("zh") else "Table of Contents").bold = True
    paragraph = document.add_paragraph()
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = ' TOC \\o "1-3" \\h \\z \\u '
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend((begin, instruction, separate, end))
    update_fields = OxmlElement("w:updateFields")
    update_fields.set(qn("w:val"), "true")
    document.settings.element.append(update_fields)
    document.add_page_break()


def _add_page_numbers(document: DocxDocument, locale: str) -> None:
    for section in document.sections:
        paragraph = section.footer.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if locale.lower().startswith("zh"):
            paragraph.add_run("第 ")
        run = paragraph.add_run()
        begin = OxmlElement("w:fldChar")
        begin.set(qn("w:fldCharType"), "begin")
        instruction = OxmlElement("w:instrText")
        instruction.set(qn("xml:space"), "preserve")
        instruction.text = " PAGE "
        end = OxmlElement("w:fldChar")
        end.set(qn("w:fldCharType"), "end")
        run._r.extend((begin, instruction, end))
        if locale.lower().startswith("zh"):
            paragraph.add_run(" 页")


def _safe_filename(title: str) -> str:
    filename = _INVALID_FILENAME.sub("_", title).strip(" .")
    if not filename:
        filename = "document"
    return f"{filename[:100].rstrip(' .') or 'document'}.docx"