from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    Image as ReportlabImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.api.generated.models import (
    BulletListBlock,
    DocumentOptions,
    DocumentSpec,
    ImageBlock,
    NumberedListBlock,
    PageBreakBlock,
    ParagraphBlock,
    QuoteBlock,
    TableBlock,
)
from app.documents.images import load_image
from app.documents.normalize import normalize_document_spec
from app.documents.text_metrics import looks_like_subheading, visual_units
from app.documents.validation import validate_document_spec

PDF_MEDIA_TYPE = "application/pdf"
_INVALID_FILENAME = re.compile(r'[\x00-\x1f<>:"/\\|?*]+')

SERVICE_ROOT = Path(__file__).resolve().parents[2]
_FONTS_DIR = SERVICE_ROOT / "config" / "fonts"

_BRAND = colors.HexColor("#565cf6")
_BRAND_SOFT = colors.HexColor("#eef0ff")
_TEXT = colors.HexColor("#202432")
_MUTED = colors.HexColor("#858c9b")
_LINE = colors.HexColor("#e8ebf1")
_ROW_ALT = colors.HexColor("#f7f8fb")
_WHITE = colors.white

# 表格列宽权重上限（全角字宽）。超过上限的窄列不再继续抢宽度，
# 避免「一列长文本 + 若干短列」时短列被压成逐字换行。
_MAX_COLUMN_UNITS = 26.0
_MIN_COLUMN_UNITS = 2.0

# 单张图片的最大显示高度：留出页眉页脚与图注的空间，避免一张竖图把版面顶到页外。
_MAX_IMAGE_HEIGHT = 19.5 * cm


@dataclass(frozen=True)
class RenderedPdf:
    content: bytes
    filename: str


class PdfRenderer:
    def render(
        self,
        document: DocumentSpec,
        options: DocumentOptions,
        *,
        request_id: str,
    ) -> RenderedPdf:
        # 渲染前统一清洗：合并「封面」小节、剥离「标题：」等标签前缀、剔除占位行，
        # 避免成稿出现重复封面标题行与未填写的占位符。
        document = normalize_document_spec(document)
        validate_document_spec(document, request_id=request_id, status_code=422)
        locale = options.locale or "zh-CN"
        is_chinese = locale.lower().startswith("zh")
        body_font, bold_font = _register_fonts(is_chinese)

        output = BytesIO()
        doc = SimpleDocTemplate(
            output,
            pagesize=A4,
            leftMargin=2.5 * cm,
            rightMargin=2.5 * cm,
            topMargin=2.5 * cm,
            bottomMargin=2.5 * cm,
            title=document.title,
        )
        styles = _build_styles(body_font, bold_font)
        story: list = []

        # 独立封面页：品牌色块 + 标题 + 副标题，正文另起一页。
        # 旧实现把标题直接排在正文上方，成稿首页看起来像没有封面的草稿。
        story.append(Spacer(1, 4.8 * cm))
        story.append(_accent_band(doc.width))
        story.append(Spacer(1, 0.52 * cm))
        story.append(Paragraph(escape(document.title), styles["CoverTitle"]))
        if document.subtitle:
            story.append(Paragraph(escape(document.subtitle), styles["CoverSubtitle"]))
        story.append(Spacer(1, 0.46 * cm))
        story.append(HRFlowable(width="46%", thickness=1, color=_LINE, spaceBefore=0, spaceAfter=0))
        story.append(PageBreak())

        if options.include_toc:
            story.append(
                Paragraph("目录" if is_chinese else "Table of Contents", styles["Heading1"])
            )
            story.append(_heading_rule())
            for section in document.sections:
                story.append(
                    Paragraph(
                        escape(section.heading),
                        styles[f"TocLevel{_heading_level(section.level)}"],
                    )
                )
            story.append(PageBreak())

        for index, section in enumerate(document.sections):
            level = _heading_level(section.level)
            # 一级章节独立成页：旧实现让章节在页中直接接排，成稿里两三个章节
            # 挤在同一页上，是「版式乱」的主要观感来源。
            if level == 1 and index > 0:
                story.append(PageBreak())
            story.append(Paragraph(escape(section.heading), styles[f"Heading{level}"]))
            if level == 1:
                story.append(_heading_rule())
            for block in section.blocks:
                _append_block(story, block, styles, doc.width)

        def _footer(canvas: object, _doc: object) -> None:
            if _doc.page == 1:  # type: ignore[attr-defined]
                # 封面不排页脚，改为底部通栏品牌色带，给封面一个收边。
                canvas.saveState()  # type: ignore[attr-defined]
                canvas.setFillColor(_BRAND)  # type: ignore[attr-defined]
                canvas.rect(0, 0, A4[0], 0.72 * cm, stroke=0, fill=1)  # type: ignore[attr-defined]
                canvas.restoreState()  # type: ignore[attr-defined]
                return
            canvas.saveState()  # type: ignore[attr-defined]
            canvas.setStrokeColor(_LINE)  # type: ignore[attr-defined]
            canvas.setLineWidth(0.5)  # type: ignore[attr-defined]
            canvas.line(doc.leftMargin, 1.78 * cm, A4[0] - doc.rightMargin, 1.78 * cm)  # type: ignore[attr-defined]
            canvas.setFont(body_font, 9)  # type: ignore[attr-defined]
            canvas.setFillColor(_MUTED)  # type: ignore[attr-defined]
            canvas.drawString(doc.leftMargin, 1.24 * cm, _footer_label(document.title))  # type: ignore[attr-defined]
            # 页码按正文页编号（封面不计数），与 PPTX 的页脚编号语义一致。
            canvas.drawRightString(A4[0] - doc.rightMargin, 1.24 * cm, str(_doc.page - 1))  # type: ignore[attr-defined]
            canvas.restoreState()  # type: ignore[attr-defined]

        doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
        return RenderedPdf(
            content=output.getvalue(),
            filename=_safe_filename(document.title),
        )


def _heading_level(level: object) -> int:
    """把任意层级的 section 收敛到已定义的 Heading1..3 样式，避免越界取样式。"""
    try:
        value = int(level)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        value = 1
    return max(1, min(3, value))


def _accent_band(width: float) -> Table:
    """封面品牌色横条：用短色块建立封面重心，避免只有一行裸标题。"""
    band = Table([[""]], colWidths=[width * 0.16], rowHeights=[0.14 * cm])
    band.hAlign = "LEFT"
    band.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), _BRAND),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return band


def _heading_rule() -> HRFlowable:
    """一级标题下的品牌色细线，强化章节分隔。"""
    return HRFlowable(width="100%", thickness=1, color=_BRAND, spaceBefore=0, spaceAfter=8)


def _footer_label(title: str, *, limit: int = 56) -> str:
    value = (title or "").strip()
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _append_block(
    story: list, block: object, styles: dict[str, ParagraphStyle], content_width: float
) -> None:
    if isinstance(block, ParagraphBlock):
        # 短句且不以句末标点结尾的段落按节内小标题排版，建立层级而不是文字墙。
        style = styles["SubHeading"] if looks_like_subheading(block.text) else styles["Body"]
        story.append(Paragraph(_inline_markup(block.text), style))
    elif isinstance(block, BulletListBlock):
        for item in block.items:
            story.append(Paragraph(f"\u2022\u00a0{_inline_markup(_clean_item(item))}", styles["Bullet"]))
    elif isinstance(block, NumberedListBlock):
        for index, item in enumerate(block.items, start=1):
            story.append(
                Paragraph(f"{index}.\u00a0{_inline_markup(_clean_item(item))}", styles["Numbered"])
            )
    elif isinstance(block, TableBlock):
        story.append(_build_table(block, styles, content_width))
    elif isinstance(block, QuoteBlock):
        story.append(Paragraph(_inline_markup(block.text), styles["Quote"]))
        if block.attribution:
            story.append(Paragraph(f"—— {escape(block.attribution)}", styles["Attribution"]))
    elif isinstance(block, PageBreakBlock):
        story.append(PageBreak())
    elif isinstance(block, ImageBlock):
        story.extend(_build_image(block, styles, content_width))


def _build_image(
    block: ImageBlock, styles: dict[str, ParagraphStyle], content_width: float
) -> list:
    """把 image 块排成「居中图片 + 居中图注」。

    图片取不到时降级为一行说明而不是抛错：文档生成的主体价值是文字内容，
    让一张失效的图片（签名过期、对象被删）打断整份成稿是不可接受的。
    """
    image = load_image(block.url)
    if image is None:
        label = block.alt or block.caption or "图片"
        return [Paragraph(f"[图片未能加载：{escape(str(label))}]", styles["Caption"])]

    width = max(1.0, content_width * float(block.width_ratio or 1.0))
    height = width / image.aspect_ratio
    if height > _MAX_IMAGE_HEIGHT:
        height = _MAX_IMAGE_HEIGHT
        width = height * image.aspect_ratio

    flowable = ReportlabImage(BytesIO(image.content), width=width, height=height)
    flowable.hAlign = "CENTER"
    result: list = [Spacer(1, 0.16 * cm), flowable]
    if block.caption:
        result.append(Paragraph(escape(block.caption), styles["Caption"]))
    return result


def _clean_item(text: str) -> str:
    """去掉列表项首尾空白，避免出现「•  两项之间双空格」的参差感。"""
    return str(text).strip()


def _inline_markup(text: str) -> str:
    """转义文本并保留换行与缩进。

    reportlab 的 Paragraph 默认把连续空白（含换行）折叠成一个空格，代码片段、
    地址、多行引用会被挤成一大段。这里把换行映射为 `<br/>`，并把行首缩进转成
    不换行空格，保证原始分行结构可见。
    """
    rendered: list[str] = []
    for line in escape(text).split("\n"):
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        rendered.append("\u00a0" * indent + stripped)
    return "<br/>".join(rendered)


def _build_table(
    block: TableBlock, styles: dict[str, ParagraphStyle], content_width: float
) -> Table:
    head = styles["TableHead"]
    cell = styles["TableCell"]
    data = [[Paragraph(escape(column), head) for column in block.columns]]
    for values in block.rows:
        row = []
        for value in values:
            row.append(Paragraph(_inline_markup(str(value)), cell))
        while len(row) < len(block.columns):
            row.append(Paragraph("", cell))
        data.append(row)

    table = Table(
        data,
        colWidths=_column_widths(block, content_width),
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                # 品牌色表头 + 斑马纹：旧实现的通体网格线让长表格看起来像未整理的草稿。
                ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
                ("TEXTCOLOR", (0, 0), (-1, 0), _WHITE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_WHITE, _ROW_ALT]),
                # 只用横向分隔线，去掉竖向网格；表头下沿用加粗品牌色强调。
                ("LINEBELOW", (0, 0), (-1, 0), 1.0, _BRAND),
                ("LINEBELOW", (0, 1), (-1, -2), 0.4, _LINE),
                ("BOX", (0, 0), (-1, -1), 0.4, _LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def _column_widths(block: TableBlock, content_width: float) -> list[float]:
    """按各列内容权重分配列宽，避免窄列被挤成逐字换行、宽列大量留白。

    权重取「表头 + 该列最长单元格」的全角字宽，并做上下限截断：下限保证每列至少
    能容纳两个汉字，上限防止某个长单元格独占全部宽度。
    """
    columns = len(block.columns)
    if columns == 0:
        return [content_width]
    weights: list[float] = []
    for col_index in range(columns):
        weight = visual_units(block.columns[col_index])
        for row in block.rows:
            if col_index < len(row):
                weight = max(weight, visual_units(str(row[col_index])))
        weights.append(min(_MAX_COLUMN_UNITS, max(_MIN_COLUMN_UNITS, weight)))
    total = sum(weights)
    return [content_width * weight / total for weight in weights]


def _build_styles(body_font: str, bold_font: str) -> dict[str, ParagraphStyle]:
    base = dict(fontName=body_font, textColor=_TEXT, wordWrap="CJK")
    # keepWithNext：标题与小标题不允许成为一页的最后一行，reportlab 会自动把它推到下一页。
    heading = dict(fontName=bold_font, wordWrap="CJK", keepWithNext=True)
    return {
        "CoverTitle": ParagraphStyle(
            "CoverTitle",
            fontName=bold_font,
            fontSize=30,
            leading=38,
            spaceAfter=10,
            textColor=_TEXT,
            wordWrap="CJK",
        ),
        "CoverSubtitle": ParagraphStyle(
            "CoverSubtitle",
            fontName=body_font,
            fontSize=14,
            leading=20,
            spaceAfter=8,
            textColor=_MUTED,
            wordWrap="CJK",
        ),
        "Heading1": ParagraphStyle(
            "Heading1",
            fontSize=18,
            leading=26,
            # 一级章节已经独占一页，不再需要页首大间距。
            spaceBefore=0,
            spaceAfter=10,
            textColor=_BRAND,
            **heading,
        ),
        "Heading2": ParagraphStyle(
            "Heading2",
            fontSize=14.5,
            leading=21,
            spaceBefore=16,
            spaceAfter=7,
            textColor=_TEXT,
            **heading,
        ),
        "Heading3": ParagraphStyle(
            "Heading3",
            fontSize=12.5,
            leading=18,
            spaceBefore=12,
            spaceAfter=5,
            textColor=_TEXT,
            **heading,
        ),
        # 节内小标题：与正文区分字号与颜色，并禁止孤立在页尾。
        "SubHeading": ParagraphStyle(
            "SubHeading",
            fontSize=12.5,
            leading=18,
            spaceBefore=10,
            spaceAfter=4,
            textColor=_BRAND,
            **heading,
        ),
        # 正文 11pt：旧实现的 10pt 在 A4 上偏小，与标题对比度不足，是「样式丑」的一部分。
        "Body": ParagraphStyle("Body", fontSize=11, leading=19, spaceAfter=8, **base),
        "Bullet": ParagraphStyle(
            "Bullet",
            fontSize=11,
            leading=19,
            spaceAfter=4,
            leftIndent=16,
            firstLineIndent=-16,
            **base,
        ),
        "Numbered": ParagraphStyle(
            "Numbered",
            fontSize=11,
            leading=19,
            spaceAfter=4,
            leftIndent=18,
            firstLineIndent=-18,
            **base,
        ),
        "Quote": ParagraphStyle(
            "Quote",
            fontName=body_font,
            fontSize=11,
            leading=19,
            leftIndent=8,
            rightIndent=8,
            backColor=_BRAND_SOFT,
            borderPadding=6,
            spaceBefore=4,
            spaceAfter=8,
            textColor=_MUTED,
            wordWrap="CJK",
        ),
        "Attribution": ParagraphStyle(
            "Attribution",
            fontName=body_font,
            fontSize=10,
            leading=14,
            spaceAfter=8,
            textColor=_MUTED,
            alignment=TA_RIGHT,
            wordWrap="CJK",
        ),
        # 图注：居中、比正文小一档、灰色，与正文形成层次且不与正文抢注意力。
        "Caption": ParagraphStyle(
            "Caption",
            fontName=body_font,
            fontSize=9.5,
            leading=14,
            spaceBefore=6,
            spaceAfter=12,
            textColor=_MUTED,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "TocLevel1": ParagraphStyle(
            "TocLevel1",
            fontName=bold_font,
            fontSize=12,
            leading=18,
            spaceAfter=4,
            textColor=_TEXT,
            wordWrap="CJK",
        ),
        "TocLevel2": ParagraphStyle(
            "TocLevel2",
            fontName=body_font,
            fontSize=11,
            leading=16,
            leftIndent=16,
            spaceAfter=3,
            textColor=_TEXT,
            wordWrap="CJK",
        ),
        "TocLevel3": ParagraphStyle(
            "TocLevel3",
            fontName=body_font,
            fontSize=10,
            leading=14,
            leftIndent=32,
            spaceAfter=2,
            textColor=_MUTED,
            wordWrap="CJK",
        ),
        # 表格必须复用已注册的中文字体，否则 Helvetica 无 CJK 字形会把整列中文吞掉。
        "TableHead": ParagraphStyle(
            "TableHead",
            fontName=bold_font,
            fontSize=10,
            leading=15,
            textColor=_WHITE,
            wordWrap="CJK",
        ),
        "TableCell": ParagraphStyle(
            "TableCell",
            fontName=body_font,
            fontSize=10,
            leading=15,
            textColor=_TEXT,
            wordWrap="CJK",
        ),
    }


def _register_fonts(is_chinese: bool) -> tuple[str, str]:
    if not is_chinese:
        return "Helvetica", "Helvetica-Bold"
    ttc = _FONTS_DIR / "wqy-microhei.ttc"
    if ttc.exists():
        _ensure_ttc("CEES-CJK", ttc)
        pdfmetrics.registerFontFamily(
            "CEES-CJK",
            normal="CEES-CJK",
            bold="CEES-CJK",
            italic="CEES-CJK",
            boldItalic="CEES-CJK",
        )
        return "CEES-CJK", "CEES-CJK"
    if "STSong-Light" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    return "STSong-Light", "STSong-Light"


def _ensure_ttc(name: str, path: Path) -> None:
    if name in pdfmetrics.getRegisteredFontNames():
        return
    pdfmetrics.registerFont(TTFont(name, str(path)))


def _safe_filename(title: str) -> str:
    filename = _INVALID_FILENAME.sub("_", title).strip(" .")
    if not filename:
        filename = "document"
    return f"{filename[:100].rstrip(' .') or 'document'}.pdf"
