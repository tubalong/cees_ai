from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Query, Request, Security
from fastapi.security import APIKeyHeader

from app.core.errors import AIServiceError
from app.core.runtime import AppRuntime

internal_token_scheme = APIKeyHeader(
    name="X-AI-Internal-Token",
    scheme_name="internalToken",
    description="Internal token issued to trusted CEES services. Do not expose it to clients.",
    auto_error=False,
)


def get_runtime(request: Request) -> AppRuntime:
    return request.app.state.runtime


def _token_valid(runtime: AppRuntime, token: str | None) -> bool:
    expected = runtime.settings.ai_internal_token
    return (
        expected is not None
        and token is not None
        and hmac.compare_digest(token, expected)
    )


async def require_internal_token(
    request: Request,
    token: Annotated[str | None, Security(internal_token_scheme)],
) -> None:
    if not _token_valid(get_runtime(request), token):
        raise AIServiceError(
            "INTERNAL_AUTH_FAILED",
            "Internal authentication failed",
            status_code=401,
        )


async def require_preview_token(
    request: Request,
    header_token: Annotated[str | None, Security(internal_token_scheme)] = None,
    query_token: Annotated[str | None, Query(alias="token")] = None,
) -> None:
    runtime = get_runtime(request)
    if not _token_valid(runtime, header_token) and not _token_valid(runtime, query_token):
        raise AIServiceError(
            "INTERNAL_AUTH_FAILED",
            "Internal authentication failed",
            status_code=401,
        )
