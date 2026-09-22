from __future__ import annotations

import json

from app.chat.follow_up import CLOSE_TAG, OPEN_TAG, FollowUpStreamFilter, parse_memory_candidate


def test_passes_plain_text_through() -> None:
    follow_up = FollowUpStreamFilter()
    assert follow_up.feed("hello ") == "hello "
    assert follow_up.feed("world") == "world"
    assert follow_up.finish() == ""
    assert follow_up.result() == ([], [])


def test_strips_follow_up_block_within_single_chunk() -> None:
    follow_up = FollowUpStreamFilter()
    text = f'答案是 X。\n\n{OPEN_TAG}["怎么申请试用？", "有免费额度吗？"]{CLOSE_TAG}'
    visible = follow_up.feed(text)
    assert visible == "答案是 X。\n\n"
    assert follow_up.finish() == ""
    # 历史格式兼容：纯追问数组解析为 questions，memories 为空。
    assert follow_up.result() == (["怎么申请试用？", "有免费额度吗？"], [])


def test_strips_block_split_across_chunks() -> None:
    follow_up = FollowUpStreamFilter()
    text = f'答案是 X。{OPEN_TAG}["怎么申请试用？"'
    # 把整个开标记与块内容切成极小片段，覆盖跨 chunk 缓冲路径。
    pieces = [text[i : i + 1] for i in range(0, len(text))]
    visible = ""
    for piece in pieces:
        visible += follow_up.feed(piece)
    visible += follow_up.feed(f', "有免费额度吗？"]{CLOSE_TAG}尾部文本')
    assert visible.startswith("答案是 X。")
    assert visible.endswith("尾部文本")
    assert follow_up.finish() == ""
    assert follow_up.result() == (["怎么申请试用？", "有免费额度吗？"], [])


def test_open_tag_prefix_held_in_buffer_until_verified() -> None:
    follow_up = FollowUpStreamFilter()
    prefix = OPEN_TAG[:5]
    assert follow_up.feed(prefix) == ""
    assert follow_up.feed("剩余正文继续") == prefix + "剩余正文继续"


def test_finish_drops_dangling_open_tag_and_closes_unclosed_block() -> None:
    follow_up = FollowUpStreamFilter()
    follow_up.feed(f'正文{OPEN_TAG}["一条追问"')
    assert follow_up.finish() == ""
    # 块未闭合时 JSON 不完整，无法可靠解析，按无追问处理。
    assert follow_up.result() == ([], [])

    dangling = FollowUpStreamFilter()
    assert dangling.feed(f"正文{OPEN_TAG[:8]}") == "正文"
    assert dangling.finish() == ""
    assert dangling.result() == ([], [])


def test_ignores_invalid_or_overlong_questions() -> None:
    follow_up = FollowUpStreamFilter()
    overlong = "x" * 40
    follow_up.feed(OPEN_TAG + f'["ok", "", 123, "{overlong}", "有效问题"]' + CLOSE_TAG)
    follow_up.finish()
    assert follow_up.result() == (["ok", "有效问题"], [])


def test_deduplicates_identical_questions_keeping_first() -> None:
    follow_up = FollowUpStreamFilter()
    follow_up.feed(
        OPEN_TAG
        + '["怎么申请试用？", " 怎么申请试用？ ", "有免费额度吗？", "怎么申请试用？"]'
        + CLOSE_TAG
    )
    follow_up.finish()
    # strip 后完全相同的追问只保留第一条（含首尾空白差异）。
    assert follow_up.result() == (["怎么申请试用？", "有免费额度吗？"], [])


def test_result_empty_without_block() -> None:
    follow_up = FollowUpStreamFilter()
    follow_up.feed("普通回答，没有建议块。")
    follow_up.finish()
    assert follow_up.result() == ([], [])


def test_parses_object_block_with_questions_and_memories() -> None:
    follow_up = FollowUpStreamFilter()
    block = (
        '{"questions": ["怎么申请试用？"], '
        '"memories": [{"type": "PREFERENCE", "content": "用户偏好简洁的周报格式"}]}'
    )
    follow_up.feed(f"回答正文。{OPEN_TAG}{block}{CLOSE_TAG}")
    follow_up.finish()
    questions, memories = follow_up.result()
    assert questions == ["怎么申请试用？"]
    assert memories == [
        {"type": "PREFERENCE", "content": "用户偏好简洁的周报格式", "action": "create"}
    ]


def test_object_block_with_memories_only() -> None:
    follow_up = FollowUpStreamFilter()
    block = '{"memories": [{"type": "FACT", "content": "用户在杭州工作"}]}'
    follow_up.feed(OPEN_TAG + block + CLOSE_TAG)
    follow_up.finish()
    questions, memories = follow_up.result()
    assert questions == []
    assert memories == [{"type": "FACT", "content": "用户在杭州工作", "action": "create"}]


def test_broken_json_returns_empty() -> None:
    follow_up = FollowUpStreamFilter()
    follow_up.feed(OPEN_TAG + '{"memories": [{"type": "FACT"' + CLOSE_TAG)
    follow_up.finish()
    assert follow_up.result() == ([], [])


def test_memories_are_limited_to_three_and_invalid_entries_dropped() -> None:
    follow_up = FollowUpStreamFilter()
    block = json_dumps_memories(
        {"type": "PREFERENCE", "content": "偏好 A"},
        {"type": "TEAM", "content": "团队级信息不应记录"},
        {"type": "FACT", "content": "事实 B"},
        {"type": "DECISION", "content": "决定 C"},
        {"type": "HABIT", "content": "习惯 D"},
        "not a dict",
    )
    follow_up.feed(OPEN_TAG + block + CLOSE_TAG)
    follow_up.finish()
    _, memories = follow_up.result()
    assert memories == [
        {"type": "PREFERENCE", "content": "偏好 A", "action": "create"},
        {"type": "FACT", "content": "事实 B", "action": "create"},
        {"type": "DECISION", "content": "决定 C", "action": "create"},
    ]


def test_update_candidate_keeps_replaces_and_normalizes_type() -> None:
    follow_up = FollowUpStreamFilter()
    block = json_dumps_memories(
        {
            "type": "preference",
            "content": "用户现在偏好更详细的周报",
            "action": "update",
            "replaces": "偏好简洁的周报",
        }
    )
    follow_up.feed(OPEN_TAG + block + CLOSE_TAG)
    follow_up.finish()
    _, memories = follow_up.result()
    assert memories == [
        {
            "type": "PREFERENCE",
            "content": "用户现在偏好更详细的周报",
            "action": "update",
            "replaces": "偏好简洁的周报",
        }
    ]


def test_update_without_valid_replaces_drops_replaces_field() -> None:
    candidate = parse_memory_candidate(
        {"type": "FACT", "content": "用户在杭州工作", "action": "update"}
    )
    assert candidate == {"type": "FACT", "content": "用户在杭州工作", "action": "update"}
    assert "replaces" not in candidate


def test_parse_memory_candidate_rejects_invalid_entries() -> None:
    assert parse_memory_candidate({"type": "FACT", "content": ""}) is None
    assert parse_memory_candidate({"type": "FACT", "content": "   "}) is None
    assert parse_memory_candidate({"type": "UNKNOWN", "content": "内容"}) is None
    assert parse_memory_candidate({"type": "FACT", "content": "x" * 1001}) is None
    assert parse_memory_candidate({"type": "FACT", "content": "合法", "action": "delete"}) == {
        "type": "FACT",
        "content": "合法",
        "action": "create",
    }


def json_dumps_memories(*entries: object) -> str:
    return json.dumps({"memories": list(entries)}, ensure_ascii=False)
