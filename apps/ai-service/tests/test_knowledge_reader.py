from __future__ import annotations

import pytest

from app.knowledge.mineru_artifact_reader import (
    from_content_list_json,
    from_markdown,
)
from app.knowledge.parsed_models import normalize_block_text

DOC_ID = "doc-1"
VERSION_ID = "docv-1"
PARSER_VERSION = "2.5.1"


def test_content_list_maps_common_mineru_types() -> None:
    payload = [
        {"type": "title", "text": "第一章", "text_level": 1, "page_idx": 0},
        {"type": "text", "text": "正文内容", "page_idx": 0},
        {
            "type": "table",
            "table_body": "<table><tr><td>a</td><td>b</td></tr></table>",
        },
        {"type": "image", "img_path": "images/0.jpg", "img_caption": ["图1 示意图"]},
        {"type": "interline_equation", "text": "E=mc^2"},
        {"type": "list", "text": "条目一"},
        {"type": "text_code", "text": "x = 1"},
    ]
    document = from_content_list_json(
        payload,
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert document.parser_name == "mineru"
    assert document.parser_version == PARSER_VERSION
    assert [block.type.value for block in document.blocks] == [
        "title",
        "paragraph",
        "table",
        "image",
        "caption",
        "formula",
        "list_item",
        "code_block",
    ]
    assert document.blocks[2].text == "a b"
    assert document.blocks[4].text == "图1 示意图"
    assert [block.source_order for block in document.blocks] == list(range(8))


def test_content_list_accepts_dict_shape_with_content_list_key() -> None:
    payload = {"content_list": [{"type": "text", "text": "顶层的列表"}]}
    document = from_content_list_json(
        payload,
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert len(document.blocks) == 1
    assert document.blocks[0].type.value == "paragraph"


def test_content_list_heading_path_tracks_ancestor_titles() -> None:
    payload = [
        {"type": "title", "text": "H1", "text_level": 1},
        {"type": "title", "text": "H2", "text_level": 2},
        {"type": "text", "text": "段落"},
    ]
    document = from_content_list_json(
        payload,
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert document.blocks[0].heading_path == ["H1"]
    assert document.blocks[1].heading_path == ["H1", "H2"]
    assert document.blocks[2].heading_path == ["H1", "H2"]


def test_content_list_bbox_and_poly_are_normalized() -> None:
    payload = [
        {"type": "text", "text": "带 bbox", "bbox": [0, 1, 2, 3]},
        {"type": "text", "text": "带 poly", "poly": [0, 0, 10, 0, 10, 8, 0, 8]},
    ]
    document = from_content_list_json(
        payload,
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert document.blocks[0].bbox == [0.0, 1.0, 2.0, 3.0]
    assert document.blocks[1].bbox == [0.0, 0.0, 10.0, 8.0]


def test_content_list_skips_empty_text_and_unknown_type_falls_back() -> None:
    payload = [
        {"type": "text", "text": ""},
        {"type": "title", "text": ""},
        {"type": "something_new", "text": "未知类型"},
    ]
    document = from_content_list_json(
        payload,
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert len(document.blocks) == 1
    assert document.blocks[0].type.value == "paragraph"
    assert document.blocks[0].text == "未知类型"


def test_content_list_rejects_unusable_payload() -> None:
    with pytest.raises(ValueError, match="payload"):
        from_content_list_json(
            {"no_list": True},
            document_id=DOC_ID,
            document_version_id=VERSION_ID,
            parser_version=PARSER_VERSION,
        )
    with pytest.raises(ValueError, match="payload"):
        from_content_list_json(
            "not-a-list",
            document_id=DOC_ID,
            document_version_id=VERSION_ID,
            parser_version=PARSER_VERSION,
        )


def test_markdown_parses_headings_paragraphs_and_tables() -> None:
    document = from_markdown(
        "# H1\n\n段落一\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert document.parser_name == "markdown"
    assert [block.type.value for block in document.blocks] == [
        "title",
        "paragraph",
        "table",
    ]
    assert document.blocks[0].text == "H1"
    assert document.blocks[0].heading_path == ["H1"]
    assert document.blocks[1].heading_path == ["H1"]
    assert document.blocks[2].text == "| a | b |\n| --- | --- |\n| 1 | 2 |"


def test_markdown_fenced_code_is_code_block_not_paragraph() -> None:
    document = from_markdown(
        "```python\nprint('hi')\n```\n",
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert len(document.blocks) == 1
    assert document.blocks[0].type.value == "code_block"
    assert "print('hi')" in document.blocks[0].text


def test_markdown_fence_keeps_inner_blank_lines() -> None:
    document = from_markdown(
        "```\nline1\n\nline2\n```\n",
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert len(document.blocks) == 1
    assert document.blocks[0].text == "line1\n\nline2"


def test_markdown_indented_code_flushes_paragraph_first() -> None:
    document = from_markdown(
        "para text\n    indented code\n",
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert [block.type.value for block in document.blocks] == [
        "paragraph",
        "code_block",
    ]
    assert document.blocks[0].text == "para text"
    assert document.blocks[1].text == "    indented code"


def test_markdown_heading_levels_update_heading_path() -> None:
    document = from_markdown(
        "# H1\n## H2\nbody\n",
        document_id=DOC_ID,
        document_version_id=VERSION_ID,
        parser_version=PARSER_VERSION,
    )
    assert document.blocks[0].heading_path == ["H1"]
    assert document.blocks[1].heading_path == ["H1", "H2"]
    assert document.blocks[2].heading_path == ["H1", "H2"]


def test_normalize_block_text_compresses_whitespace() -> None:
    assert normalize_block_text("  a \t b  ") == "a b"
    assert normalize_block_text("line1\nline2") == "line1\nline2"
    assert normalize_block_text("x\n\n\n\ny") == "x\n\ny"
