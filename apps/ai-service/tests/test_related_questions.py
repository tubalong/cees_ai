from __future__ import annotations

from fastapi.testclient import TestClient

from app.chat.related_questions import _parse_questions
from app.core.config import ModelRole
from app.llm.router import LLMRouter
from app.main import create_app
from tests.helpers import StubProvider, catalog, chat_config, profile, ready_runtime, result


def build_related_questions_client(
    outcomes: list[object],
) -> tuple[TestClient, StubProvider]:
    model_profile = profile()
    provider = StubProvider(model_profile, outcomes)
    model_catalog = catalog(
        {"primary": model_profile},
        {ModelRole.default: ["primary"]},
        chat=chat_config(),
    )
    router = LLMRouter(model_catalog, lambda _name, _profile: provider)
    return TestClient(create_app(runtime=ready_runtime(router, model_catalog))), provider


def payload() -> dict[str, object]:
    return {
        "request_id": "req-related-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "conversation_id": "conversation-1",
        "user_message": "怎么申请试用？",
        "assistant_reply": "联系管理员开通试用账号即可。",
    }


def test_related_questions_requires_internal_token() -> None:
    client, _ = build_related_questions_client(outcomes=[result('["unused"]')])

    with client:
        response = client.post("/internal/v1/chat/related-questions", json=payload())

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INTERNAL_AUTH_FAILED"


def test_related_questions_returns_questions_and_execution() -> None:
    client, provider = build_related_questions_client(
        outcomes=[result('["试用期多长？", "有哪些功能模块？", "如何邀请同事？"]')]
    )

    with client:
        response = client.post(
            "/internal/v1/chat/related-questions",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload(),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["questions"] == ["试用期多长？", "有哪些功能模块？", "如何邀请同事？"]
    assert body["execution"]["profile"] == "primary"
    assert len(provider.calls) == 1
    assert provider.calls[0][1].max_output_tokens == 512


def test_related_questions_filters_empty_long_and_non_string_items() -> None:
    long_question = "这个问题的字数确实已经超过了三十个字的硬性上限约束所以必须被过滤掉"
    client, _ = build_related_questions_client(
        outcomes=[result(f'["试用期多长？", "", 42, "   ", "{long_question}"]')]
    )

    with client:
        response = client.post(
            "/internal/v1/chat/related-questions",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload(),
        )

    assert response.status_code == 200
    assert response.json()["questions"] == ["试用期多长？"]


def test_related_questions_rejects_invalid_output() -> None:
    client, _ = build_related_questions_client(outcomes=[result("无法生成推荐问题。")])

    with client:
        response = client.post(
            "/internal/v1/chat/related-questions",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload(),
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "RELATED_QUESTIONS_INVALID"


def test_related_questions_rejects_truncated_output() -> None:
    client, _ = build_related_questions_client(
        outcomes=[result('["试用期多长？"', finish_reason="length")]
    )

    with client:
        response = client.post(
            "/internal/v1/chat/related-questions",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload(),
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "RELATED_QUESTIONS_TRUNCATED"


def test_parse_questions_accepts_plain_json_array() -> None:
    assert _parse_questions('["问题一", "问题二"]') == ["问题一", "问题二"]


def test_parse_questions_accepts_markdown_fenced_array() -> None:
    assert _parse_questions('```json\n["问题一"]\n```') == ["问题一"]


def test_parse_questions_returns_empty_for_non_array_output() -> None:
    assert _parse_questions('{"questions": ["问题一"]}') == []
    assert _parse_questions("not json at all") == []


def test_parse_questions_caps_at_three_short_items() -> None:
    assert _parse_questions('["一", "二", "三", "四"]') == ["一", "二", "三"]
