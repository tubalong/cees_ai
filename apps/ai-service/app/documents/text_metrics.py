"""跨渲染器共用的文本宽度近似度量。

python-pptx 与 reportlab 都不提供「这段文字要占几行」的测量接口。这里用
「中日韩全角字符 = 1 个字宽，其它字符 ≈ 0.55 个字宽，空格 ≈ 0.3 个字宽」
的近似，把文本换算成等价的字宽单位，供 PPTX 版心排版游标推进和 PDF 表格
列宽分配共用，保证两个渲染器的换行估算一致。
"""

from __future__ import annotations

import math

_CJK_RANGE_START = 0x2E80


def visual_units(text: str) -> float:
    """把文本估算为等价的「全角字宽」数量。"""
    units = 0.0
    for char in str(text):
        if char == "\t":
            units += 1.0
        elif ord(char) >= _CJK_RANGE_START:
            units += 1.0
        elif char == " ":
            units += 0.3
        else:
            units += 0.55
    return units


def wrap_lines(text: str, font_size_pt: float, width_pt: float) -> int:
    """估算给定字号与可用宽度下文本占用的行数（含显式换行）。"""
    per_line = max(1.0, max(1.0, float(width_pt)) / float(font_size_pt))
    lines = 0
    for part in str(text).split("\n"):
        lines += max(1, math.ceil(visual_units(part) / per_line))
    return max(1, lines)


_SENTENCE_END = "。！？；!?;"
SUBHEADING_MAX_UNITS = 22.0


def looks_like_subheading(text: str, *, max_units: float = SUBHEADING_MAX_UNITS) -> bool:
    """判断一段文字是否像节内「小标题」：短、单行、不以句末标点结尾。

    LLM 生成的讲义会把节内小标题（如「核心特征（关键概念速览）」）写成普通段落块。
    渲染器据此把它按小标题排版，建立「标题 > 小标题 > 正文」的层级，而不是与正文
    同字号排成一堵没有层级的文字墙。
    """
    value = (text or "").strip()
    if not value or "\n" in value:
        return False
    if value[-1] in _SENTENCE_END:
        return False
    return visual_units(value) <= max_units
