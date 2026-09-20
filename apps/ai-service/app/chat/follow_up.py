from __future__ import annotations

import json
import re

OPEN_TAG = "<follow_up_questions>"
CLOSE_TAG = "</follow_up_questions>"
MAX_QUESTION_COUNT = 3
MAX_QUESTION_CHARS = 30

# 追加在系统指令之后：模型在同一轮回答正文末尾直接输出追问块，不再有第二次调用。
FOLLOW_UP_INSTRUCTION = """在输出最终回答时，回答正文结束之后另起一行输出一个追问建议块，格式为：
<follow_up_questions>["追问一", "追问二"]</follow_up_questions>
要求：块内是 JSON 字符串数组，1 到 3 条；每条是一句简短的话，不超过 30 个字；
与当前回答直接相关；不重复回答里已说明的内容；没有值得追问的内容时可以省略整个块。
块是给系统解析的，不要把块的任何内容混入回答正文，也不要解释或转述块本身。
如果本轮会调用工具（而不是直接输出最终回答），不要输出追问块。"""


class FollowUpStreamFilter:
    """流式剥离追问块：块外文本原样转发给用户，块内文本截获用于解析追问。"""

    def __init__(self) -> None:
        self._buffer = ""
        self._in_block = False
        self._block_text = ""

    def feed(self, text: str) -> str:
        """喂入一段流式文本，返回应转发的可见文本（追问块内容被截获）。"""
        if not text:
            return ""
        visible_parts: list[str] = []
        combined = self._buffer + text
        self._buffer = ""
        while combined:
            if not self._in_block:
                index = combined.find(OPEN_TAG)
                if index == -1:
                    remaining, held = _hold_tag_prefix(combined, OPEN_TAG)
                    self._buffer = held
                    visible_parts.append(remaining)
                    combined = ""
                else:
                    visible_parts.append(combined[:index])
                    combined = combined[index + len(OPEN_TAG):]
                    self._in_block = True
            else:
                index = combined.find(CLOSE_TAG)
                if index == -1:
                    remaining, held = _hold_tag_prefix(combined, CLOSE_TAG)
                    self._buffer = held
                    self._block_text += remaining
                    combined = ""
                else:
                    self._block_text += combined[:index]
                    combined = combined[index + len(CLOSE_TAG):]
                    self._in_block = False
        return "".join(visible_parts)

    def finish(self) -> str:
        """流结束：块内残留并入追问解析，块外残留作为可见文本返回。"""
        if self._in_block:
            if not (self._buffer and CLOSE_TAG.startswith(self._buffer)):
                self._block_text += self._buffer
            self._buffer = ""
            return ""
        leftover = self._buffer
        self._buffer = ""
        if leftover and OPEN_TAG.startswith(leftover):
            # 追问块刚起头就中断：丢弃残片，不污染回答正文。
            return ""
        return leftover

    def result(self) -> list[str]:
        """解析已截获的追问块；无块或解析失败返回空列表。"""
        return _parse_questions(self._block_text)


def _hold_tag_prefix(combined: str, tag: str) -> tuple[str, str]:
    """把尾部恰好是 tag 前缀的最长后缀扣下，返回 (剩余部分, 扣下的前缀)。"""
    max_keep = min(len(combined), len(tag) - 1)
    for keep in range(max_keep, 0, -1):
        if tag.startswith(combined[-keep:]):
            return combined[:-keep], combined[-keep:]
    return combined, ""


def _parse_questions(raw: str) -> list[str]:
    stripped = raw.strip()
    if not stripped:
        return []
    candidates: list[str] = []
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", stripped, flags=re.DOTALL)
        if not match:
            return []
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(parsed, list):
        return []
    for item in parsed:
        if not isinstance(item, str):
            continue
        question = item.strip()
        if not question or len(question) > MAX_QUESTION_CHARS:
            continue
        candidates.append(question)
    return candidates[:MAX_QUESTION_COUNT]
