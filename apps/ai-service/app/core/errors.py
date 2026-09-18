from __future__ import annotations

import json
from typing import NamedTuple

CREDENTIAL_STATUS_CODES = frozenset({401, 403})
QUOTA_STATUS_CODES = frozenset({402})
UNSUPPORTED_INPUT_STATUS_CODES = frozenset({400, 413, 415, 422})
# 上游错误正文会进入日志与错误消息，需要截断以避免超长或敏感内容外溢。
PROVIDER_DETAIL_MAX_CHARS = 300


class AIServiceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        retryable: bool = False,
        request_id: str | None = None,
        execution: object | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.request_id = request_id
        self.execution = execution


class ProviderTransientError(Exception):
    """A provider failure that may be retried on a different configured profile."""


class ProviderPermanentError(Exception):
    """A provider failure that must not trigger cross-profile fallback.

    Carries the upstream status code and response detail so the router can map
    401/403 (凭据问题) 、400/422（请求不被接受，例如不支持图片输入）与其它 4xx
    到不同的错误码与可操作提示，而不是统一塌缩成一句无法定位的通用文案。
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        upstream_detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.upstream_detail = upstream_detail


class ProviderOutputError(Exception):
    """The provider response could not be parsed or validated."""


class ProviderRejection(NamedTuple):
    """上游拒绝请求后可对外暴露的分类结果。"""

    code: str
    message: str
    retryable: bool
    status_code: int


def describe_provider_rejection(
    exc: ProviderPermanentError,
    *,
    profile: str,
    provider: str,
    model: str,
    api_key_env: str | None = None,
) -> ProviderRejection:
    """把上游 4xx 分类成可诊断、可操作的错误。

    上游把「密钥无效」「账号欠费」「不支持本次输入」都表现为 4xx。若不分类，
    这三类问题会塌缩成同一句通用文案，调用方既无法判断是配置问题、计费问题
    还是输入问题，也无法据此决定是否需要用户换一种输入。
    """
    context = f"provider={provider}, model={model}, profile={profile}"
    if api_key_env:
        context = f"{context}, api_key_env={api_key_env}"
    detail = (exc.upstream_detail or str(exc)).strip()[:PROVIDER_DETAIL_MAX_CHARS]
    suffix = f" ({context}, detail={detail})" if detail else f" ({context})"

    status_code = exc.status_code
    if status_code in CREDENTIAL_STATUS_CODES:
        return ProviderRejection(
            code="LLM_PROVIDER_AUTH_FAILED",
            message=f"The upstream provider rejected the configured credentials{suffix}",
            retryable=False,
            status_code=503,
        )
    if status_code in QUOTA_STATUS_CODES:
        return ProviderRejection(
            code="LLM_PROVIDER_QUOTA_EXHAUSTED",
            message=(
                "The upstream provider account cannot serve the request"
                f" (billing arrears or exhausted quota){suffix}"
            ),
            retryable=False,
            status_code=503,
        )
    if status_code in UNSUPPORTED_INPUT_STATUS_CODES:
        return ProviderRejection(
            code="LLM_UNSUPPORTED_INPUT",
            message=(
                "The upstream provider does not accept this request payload"
                f" (for example an unsupported image or attachment){suffix}"
            ),
            retryable=False,
            status_code=400,
        )
    return ProviderRejection(
        code="LLM_UNAVAILABLE",
        message=f"The selected provider rejected the request{suffix}",
        retryable=False,
        status_code=503,
    )
