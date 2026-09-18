"""演示/文档大纲的轻量语义清洗，供 PPTX 与 PDF 渲染器共用。

LLM 在生成「讲义/演示稿」时，常按用户要求插入一个「封面」小节，并把标题、
副标题、讲师、日期写成带标签的正文行（例如「标题：XXX」「副标题：XXX」
「讲师：_____（占位）」）。这些内容与渲染器自动生成的封面重复，而且占位符
会原样出现在成稿里，是「版式乱、样式丑」的重要来源。

这里集中处理三类清洗，保证两个渲染器的行为一致：

1. 封面小节识别：首个且仅含标题/副标题/说明的「封面」小节并入封面页。
2. 标签前缀剥离：去掉「标题：」「副标题：」等标签，只保留取值。
3. 占位符剔除：丢掉「讲师：_____（占位）」这类尚未填写的占位行。
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

# 被视为「封面」的小节标题。
COVER_HEADINGS = {
    "封面",
    "封面页",
    "首页",
    "标题页",
    "标题",
    "cover",
    "title",
    "title slide",
    "cover page",
}

# 「标题：」「副标题：」「主题：」等标签前缀。
_LABEL_PATTERN = re.compile(
    r"^\s*(副标题|副题|子标题|标题|主题|subtitle|title|subject)\s*[:：]\s*",
    re.IGNORECASE,
)
_SUBTITLE_LABELS = {"副标题", "副题", "子标题", "subtitle"}
_PLACEHOLDER_TOKENS = (
    "占位",
    "待填",
    "待补充",
    "待定",
    "placeholder",
    "to be filled",
    "tbd",
)
_UNDERSCORE_RUN = re.compile(r"[_＿]{3,}")
_MEANINGFUL_TEXT = re.compile(r"[\w\u4e00-\u9fff]")


@dataclass(frozen=True)
class CoverDetails:
    """从封面小节中提炼出的封面补充信息。"""

    subtitle: str | None = None
    meta: list[str] = field(default_factory=list)


def is_cover_heading(heading: str | None) -> bool:
    if not heading:
        return False
    return heading.strip().lower() in COVER_HEADINGS


def strip_label_prefix(text: str) -> str:
    """去掉「标题：」「副标题：」等标签前缀，只保留取值部分。"""
    return _LABEL_PATTERN.sub("", (text or "").strip()).strip()


def is_placeholder_line(text: str) -> bool:
    """判断一行是否只是待填写的占位（不应出现在成稿中）。"""
    stripped = (text or "").strip()
    if not stripped:
        return True
    lowered = stripped.lower()
    if any(token in lowered for token in _PLACEHOLDER_TOKENS):
        return True
    if _UNDERSCORE_RUN.search(stripped):
        remainder = _UNDERSCORE_RUN.sub("", stripped)
        # 去掉下划线后若不再有实质文字（仅剩标签/标点），视为占位。
        return not _MEANINGFUL_TEXT.search(remainder)
    return False


def refine_cover(lines: Iterable[str], *, document_title: str) -> CoverDetails:
    """把封面小节的文本行归纳为副标题与说明信息，去掉与文档标题重复的内容。"""
    normalized_title = (document_title or "").strip()
    subtitle: str | None = None
    meta: list[str] = []
    seen: set[str] = set()

    for raw in lines:
        text = (raw or "").strip()
        if not text:
            continue
        label_match = _LABEL_PATTERN.match(text)
        label = label_match.group(1).lower() if label_match else ""
        value = strip_label_prefix(text)
        if label in _SUBTITLE_LABELS:
            if subtitle is None and not is_placeholder_line(value):
                subtitle = value
            continue
        if is_placeholder_line(value):
            continue
        if value == normalized_title:
            continue
        if value in seen:
            continue
        seen.add(value)
        meta.append(value)

    return CoverDetails(subtitle=subtitle, meta=meta)


def looks_like_cover(lines: Sequence[str], *, heading: str | None, document_title: str) -> bool:
    """首个「封面」小节是否是纯封面信息（而非有实质内容的一章）。

    只在标题命中封面词、且正文足够短、没有表格/图片等重内容时才并入封面，
    避免误吞真正的章节。
    """
    if not is_cover_heading(heading):
        return False
    combined = "".join(lines)
    return len(combined) <= 240
