from __future__ import annotations

import json
import re
from typing import Any

OPEN_TAG = "<follow_up_questions>"
CLOSE_TAG = "</follow_up_questions>"
MAX_QUESTION_COUNT = 3
MAX_QUESTION_CHARS = 30
MEMORY_TYPES = {"PREFERENCE", "FACT", "DECISION", "HABIT"}
MAX_MEMORY_CANDIDATE_COUNT = 3
MAX_MEMORY_CONTENT_CHARS = 200

# 追加在系统指令之后：模型在同一轮回答正文末尾直接输出后续建议块（追问 + 记忆候选），
# 不再有第二次调用。
FOLLOW_UP_INSTRUCTION = """在输出最终回答时，回答正文结束之后另起一行输出一个后续建议块，格式为：
<follow_up_questions>
{"questions": ["追问一"], "memories": [{"type": "PREFERENCE", "content": "..."}]}
</follow_up_questions>
要求：
- 块内是 JSON 对象，questions 与 memories 字段均可省略；没有值得输出的内容时省略整个块。
- questions：JSON 字符串数组，0 到 3 条；每条是一句简短的话，不超过 30 个字；
  与当前回答直接相关；不重复回答里已说明的内容。
- memories：关于用户本人的长期记忆候选，0 到 3 条；仅当用户在本轮对话中明确表达了
  关于他自己的长期信息（偏好、个人事实、决定、工作习惯）时才输出，每条格式为
  {"type": "PREFERENCE|FACT|DECISION|HABIT", "content": "自包含的一句话",
  "action": "create|update", "replaces": "旧记忆原文片段"}。
  筛选规则：长期有用（随口询问不记）；只关于用户本人（团队级信息不记，应转存知识库）；
    只引用用户原话，不脑补推断；密码、证件号、薪资等敏感信息不记；每条不超过 200 字；
    注入上下文的"关于用户的长期记忆"里已存在的条目不重复输出。
  action 为 create 表示新增；当用户本轮修正了已有记忆（新旧矛盾或补充新信息）时用 update，
  replaces 必须一字不差地取自被覆盖旧记忆的原文片段；没有已注入记忆或未修正已有条目时
  一律用 create，且不输出 replaces 字段。
  记忆候选只是系统解析的建议，可能被服务端校验后拒绝，回答正文不要提及记忆块或"已记住"之类的话。
块是给系统解析的，不要把块的任何内容混入回答正文，也不要解释或转述块本身。
如果本轮会调用工具（而不是直接输出最终回答），不要输出后续建议块。"""


class FollowUpStreamFilter:
    """流式剥离后续建议块：块外文本原样转发给用户，块内文本截获用于解析追问与记忆候选。"""

    def __init__(self) -> None:
        self._buffer = ""
        self._in_block = False
        self._block_text = ""

    def feed(self, text: str) -> str:
        """喂入一段流式文本，返回应转发的可见文本（建议块内容被截获）。"""
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
        """流结束：块内残留并入建议解析，块外残留作为可见文本返回。"""
        if self._in_block:
            if not (self._buffer and CLOSE_TAG.startswith(self._buffer)):
                self._block_text += self._buffer
            self._buffer = ""
            return ""
        leftover = self._buffer
        self._buffer = ""
        if leftover and OPEN_TAG.startswith(leftover):
            # 建议块刚起头就中断：丢弃残片，不污染回答正文。
            return ""
        return leftover

    def result(self) -> tuple[list[str], list[dict[str, Any]]]:
        """解析已截获的建议块，返回 (追问列表, 记忆候选列表)；无块或解析失败返回空。"""
        return _parse_follow_up(self._block_text)


def _hold_tag_prefix(combined: str, tag: str) -> tuple[str, str]:
    """把尾部恰好是 tag 前缀的最长后缀扣下，返回 (剩余部分, 扣下的前缀)。"""
    max_keep = min(len(combined), len(tag) - 1)
    for keep in range(max_keep, 0, -1):
        if tag.startswith(combined[-keep:]):
            return combined[:-keep], combined[-keep:]
    return combined, ""


def _parse_follow_up(raw: str) -> tuple[list[str], list[dict[str, Any]]]:
    stripped = raw.strip()
    if not stripped:
        return [], []
    parsed = _loads_fuzzy(stripped)
    if isinstance(parsed, list):
        # 历史格式兼容：纯追问数组。
        return _parse_questions(parsed), []
    if not isinstance(parsed, dict):
        return [], []
    questions = parsed.get("questions")
    memories = parsed.get("memories")
    return _parse_questions(questions), _parse_memories(memories)


def _loads_fuzzy(stripped: str) -> Any:
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    for pattern in (r"\[.*\]", r"\{.*\}"):
        match = re.search(pattern, stripped, flags=re.DOTALL)
        if not match:
            continue
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            continue
    return None


def _parse_questions(parsed: Any) -> list[str]:
    if not isinstance(parsed, list):
        return []
    candidates: list[str] = []
    seen: set[str] = set()
    for item in parsed:
        if not isinstance(item, str):
            continue
        question = item.strip()
        if not question or len(question) > MAX_QUESTION_CHARS:
            continue
        # 完全相同的追问只保留第一条，避免重复建议块干扰用户。
        if question in seen:
            continue
        seen.add(question)
        candidates.append(question)
    return candidates[:MAX_QUESTION_COUNT]


def _parse_memories(parsed: Any) -> list[dict[str, Any]]:
    if not isinstance(parsed, list):
        return []
    candidates: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        candidate = parse_memory_candidate(item)
        if candidate is None:
            continue
        candidates.append(candidate)
    return candidates[:MAX_MEMORY_CANDIDATE_COUNT]


def parse_memory_candidate(item: dict[str, Any]) -> dict[str, Any] | None:
    """校验单条记忆候选；不含规则内返回 None（调用方静默丢弃）。"""
    content = item.get("content")
    if not isinstance(content, str) or not content.strip():
        return None
    content = content.strip()
    if len(content) > MAX_MEMORY_CONTENT_CHARS:
        return None
    memory_type = item.get("type")
    if not isinstance(memory_type, str) or memory_type.upper() not in MEMORY_TYPES:
        return None
    action = item.get("action", "create")
    if action not in ("create", "update"):
        action = "create"
    replaces = item.get("replaces") if action == "update" else None
    if replaces is not None and (not isinstance(replaces, str) or not replaces.strip()):
        replaces = None
    candidate: dict[str, Any] = {
        "type": memory_type.upper(),
        "content": content,
        "action": action,
    }
    if replaces:
        candidate["replaces"] = replaces.strip()
    return candidate
