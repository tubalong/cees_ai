"""上游 Provider 永久失败（4xx 等）的分类映射测试。

上游把「密钥无效」「账号欠费」「不支持本次输入」都表现为 4xx；若不做分类，
这三类问题会塌缩成同一句通用文案，调用方无法判断问题归属。这里固化分类行为，
防止后续重构悄悄退化为统一的 LLM_UNAVAILABLE。
"""

from __future__ import annotations

import pytest

from app.core.config import ModelRole, OutputMode
from app.core.errors import AIServiceError, ProviderPermanentError
from app.llm.router import LLMRouter
from app.llm.types import ChatMessage
from tests.helpers import StubProvider, catalog, profile


@pytest.mark.parametrize(
    ("status_code", "expected_code", "expected_status"),
    [
        (401, "LLM_PROVIDER_AUTH_FAILED", 503),
        (403, "LLM_PROVIDER_AUTH_FAILED", 503),
        (402, "LLM_PROVIDER_QUOTA_EXHAUSTED", 503),
        (400, "LLM_UNSUPPORTED_INPUT", 400),
        (422, "LLM_UNSUPPORTED_INPUT", 400),
        (413, "LLM_UNSUPPORTED_INPUT", 400),
        (415, "LLM_UNSUPPORTED_INPUT", 400),
    ],
)
@pytest.mark.asyncio
async def test_permanent_rejection_is_classified_by_status(
    status_code: int, expected_code: str, expected_status: int
) -> None:
    primary_profile = profile()
    provider = StubProvider(
        primary_profile,
        [
            ProviderPermanentError(
                f"provider status {status_code}",
                status_code=status_code,
                upstream_detail="upstream says no",
            )
        ],
    )
    router = LLMRouter(
        catalog({"primary": primary_profile}, {ModelRole.default: ["primary"]}),
        lambda _name, _profile: provider,
    )

    with pytest.raises(AIServiceError) as raised:
        await router.invoke(
            request_id="req-classify",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="hello")],
            output_mode=OutputMode.text,
            role=ModelRole.default,
            profile_override=None,
            temperature=None,
            max_output_tokens=None,
        )

    assert raised.value.code == expected_code
    assert raised.value.status_code == expected_status
    assert raised.value.retryable is False
    # 上游细节必须保留，否则无法定位是哪个 provider/model/key 出错。
    assert "primary" in raised.value.message
    assert "upstream says no" in raised.value.message


@pytest.mark.asyncio
async def test_unclassified_permanent_status_falls_back_to_unavailable() -> None:
    primary_profile = profile()
    provider = StubProvider(
        primary_profile,
        [ProviderPermanentError("provider status 409", status_code=409)],
    )
    router = LLMRouter(
        catalog({"primary": primary_profile}, {ModelRole.default: ["primary"]}),
        lambda _name, _profile: provider,
    )

    with pytest.raises(AIServiceError) as raised:
        await router.invoke(
            request_id="req-fallback",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="hello")],
            output_mode=OutputMode.text,
            role=ModelRole.default,
            profile_override=None,
            temperature=None,
            max_output_tokens=None,
        )

    assert raised.value.code == "LLM_UNAVAILABLE"
    assert raised.value.retryable is False


@pytest.mark.asyncio
async def test_streaming_rejection_is_classified_too() -> None:
    primary_profile = profile()
    provider = StubProvider(
        primary_profile,
        [],
        stream_outcomes=[[ProviderPermanentError("provider status 401", status_code=401)]],
    )
    router = LLMRouter(
        catalog({"primary": primary_profile}, {ModelRole.default: ["primary"]}),
        lambda _name, _profile: provider,
    )

    with pytest.raises(AIServiceError) as raised:
        await router.start_stream(
            request_id="req-stream",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="hello")],
            role=ModelRole.default,
            profile_override=None,
            temperature=None,
            max_output_tokens=None,
        )

    assert raised.value.code == "LLM_PROVIDER_AUTH_FAILED"
    assert raised.value.retryable is False
