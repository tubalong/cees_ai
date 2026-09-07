from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Request, Security
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


async def require_internal_token(
    request: Request,
    token: Annotated[str | None, Security(internal_token_scheme)],
) -> None:
    runtime = get_runtime(request)
    expected = runtime.settings.ai_internal_token
    if expected is None or token is None or not hmac.compare_digest(token, expected):
        raise AIServiceError(
            "INTERNAL_AUTH_FAILED",
            "Internal authentication failed",
            status_code=401,
        )
