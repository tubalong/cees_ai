from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Header, Request

from app.core.errors import AIServiceError
from app.core.runtime import AppRuntime


def get_runtime(request: Request) -> AppRuntime:
    return request.app.state.runtime


async def require_internal_token(
    request: Request,
    token: Annotated[str | None, Header(alias="X-AI-Internal-Token")] = None,
) -> None:
    runtime = get_runtime(request)
    expected = runtime.settings.ai_internal_token
    if expected is None or token is None or not hmac.compare_digest(token, expected):
        raise AIServiceError(
            "INTERNAL_AUTH_FAILED",
            "Internal authentication failed",
            status_code=401,
        )
