from __future__ import annotations

from app.chat.follow_up import CLOSE_TAG, OPEN_TAG, FollowUpStreamFilter


def test_passes_plain_text_through() -> None:
    follow_up = FollowUpStreamFilter()
    assert follow_up.feed("hello ") == "hello "
    assert follow_up.feed("world") == "world"
    assert follow_up.finish() == ""
    assert follow_up.result() == []


def test_strips_follow_up_block_within_single_chunk() -> None:
    follow_up = FollowUpStreamFilter()
    text = f'答案是 X。\n\n{OPEN_TAG}["怎么申请试用？", "有免费额度吗？"]{CLOSE_TAG}'
    visible = follow_up.feed(text)
    assert visible == "答案是 X。\n\n"
    assert follow_up.finish() == ""
    assert follow_up.result() == ["怎么申请试用？", "有免费额度吗？"]


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
    assert follow_up.result() == ["怎么申请试用？", "有免费额度吗？"]


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
    assert follow_up.result() == []

    dangling = FollowUpStreamFilter()
    assert dangling.feed(f"正文{OPEN_TAG[:8]}") == "正文"
    assert dangling.finish() == ""
    assert dangling.result() == []


def test_ignores_invalid_or_overlong_questions() -> None:
    follow_up = FollowUpStreamFilter()
    overlong = "x" * 40
    follow_up.feed(OPEN_TAG + f'["ok", "", 123, "{overlong}", "有效问题"]' + CLOSE_TAG)
    follow_up.finish()
    assert follow_up.result() == ["ok", "有效问题"]


def test_result_empty_without_block() -> None:
    follow_up = FollowUpStreamFilter()
    follow_up.feed("普通回答，没有追问块。")
    follow_up.finish()
    assert follow_up.result() == []
