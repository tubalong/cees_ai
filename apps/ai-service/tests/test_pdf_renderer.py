from __future__ import annotations

import base64
from io import BytesIO

import fitz
import pytest
from PIL import Image

from app.api.generated.models import DocumentOptions, DocumentSpec
from app.core.errors import AIServiceError
from app.documents.pdf_renderer import PdfRenderer


def png_data_url(width: int = 8, height: int = 4) -> str:
    """构造确定尺寸的内联 PNG，避免测试依赖外网与磁盘文件。"""
    buffer = BytesIO()
    Image.new("RGB", (width, height), (200, 30, 30)).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def document_data() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "title": "项目实施方案",
        "subtitle": "MVP",
        "sections": [
            {
                "heading": "范围",
                "level": 1,
                "blocks": [
                    {"type": "paragraph", "text": "交付首个可控版本。"},
                    {"type": "bullet_list", "items": ["撰写", "渲染"]},
                    {"type": "numbered_list", "items": ["评审", "发布"]},
                    {
                        "type": "table",
                        "columns": ["阶段", "负责人"],
                        "rows": [["构建", "团队"]],
                    },
                    {"type": "quote", "text": "保持受控。", "attribution": "CEES"},
                ],
            }
        ],
        "source_refs": [],
    }


def render_options(*, include_toc: bool = False) -> DocumentOptions:
    return DocumentOptions.model_validate(
        {"locale": "zh-CN", "template_id": "business-standard", "include_toc": include_toc}
    )


def themed_options(template_id: str) -> DocumentOptions:
    return DocumentOptions.model_validate(
        {"locale": "zh-CN", "template_id": template_id, "include_toc": False}
    )


def document_with_subheading() -> DocumentSpec:
    """带节内小标题的文档：小标题是短句且不以句末标点结尾。"""
    payload = document_data()
    payload["sections"][0]["blocks"].insert(0, {"type": "paragraph", "text": "核心特征"})
    return DocumentSpec.model_validate(payload)


def span_sizes(pdf: fitz.Document) -> dict[str, float]:
    sizes: dict[str, float] = {}
    for page in pdf:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    text = span["text"].strip()
                    if text:
                        sizes[text] = span["size"]
    return sizes


def test_renders_pdf_with_embedded_cjk_text() -> None:
    rendered = PdfRenderer().render(
        DocumentSpec.model_validate(document_data()),
        render_options(),
        request_id="req-render-pdf-1",
    )

    assert rendered.content.startswith(b"%PDF-")
    assert rendered.filename.endswith(".pdf")

    pdf = fitz.open(stream=rendered.content, filetype="pdf")
    text = "".join(page.get_text() for page in pdf)
    assert "项目实施方案" in text
    assert "范围" in text
    assert "交付首个可控版本" in text
    assert "撰写" in text
    assert "评审" in text


def test_cover_page_holds_title_only() -> None:
    """封面独立成页：标题在首页，正文从下一页开始。"""
    rendered = PdfRenderer().render(
        document_with_subheading(),
        render_options(),
        request_id="req-render-pdf-cover",
    )
    pdf = fitz.open(stream=rendered.content, filetype="pdf")

    assert pdf.page_count >= 2
    assert "项目实施方案" in pdf[0].get_text()
    # 正文不应与封面挤在同一页，否则成稿首页看起来像没有封面的草稿。
    assert "范围" not in pdf[0].get_text()
    assert "交付首个可控版本" in "".join(page.get_text() for page in pdf[1:])


def test_subheading_paragraph_is_larger_than_body() -> None:
    """节内小标题必须与正文拉开字号层级，避免排成一堵文字墙。"""
    rendered = PdfRenderer().render(
        document_with_subheading(),
        render_options(),
        request_id="req-render-pdf-subheading",
    )
    pdf = fitz.open(stream=rendered.content, filetype="pdf")
    sizes = span_sizes(pdf)

    assert sizes["核心特征"] > sizes["交付首个可控版本。"]


def test_rejects_table_rows_with_wrong_column_count() -> None:
    payload = document_data()
    payload["sections"][0]["blocks"][3]["rows"] = [["构建"]]

    with pytest.raises(AIServiceError) as raised:
        PdfRenderer().render(
            DocumentSpec.model_validate(payload),
            render_options(),
            request_id="req-render-pdf-2",
        )
    assert raised.value.status_code == 422


def test_executive_dark_uses_a_dark_vector_cover() -> None:
    rendered = PdfRenderer().render(
        DocumentSpec.model_validate(document_data()),
        themed_options("executive-dark"),
        request_id="req-render-pdf-executive",
    )
    pdf = fitz.open(stream=rendered.content, filetype="pdf")
    pixel = pdf[0].get_pixmap(matrix=fitz.Matrix(0.2, 0.2), alpha=False).pixel(2, 2)

    assert max(pixel) < 80
