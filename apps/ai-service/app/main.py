from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.generated.models import ErrorDetail, ErrorResponse
from app.api.routes.invoke import router as invoke_router
from app.api.routes.system import router as system_router
from app.core.errors import AIServiceError
from app.core.logging import configure_logging
from app.core.runtime import AppRuntime, build_runtime
from app.llm.router import ProviderBuilder

logger = logging.getLogger(__name__)


def create_app(
    *,
    runtime: AppRuntime | None = None,
    provider_builder: ProviderBuilder | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        resolved_runtime = runtime or build_runtime(provider_builder=provider_builder)
        configure_logging(resolved_runtime.settings.log_level)
        application.state.runtime = resolved_runtime
        yield

    application = FastAPI(
        title="CEES AI Service Internal API",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.include_router(system_router)
    application.include_router(invoke_router)

    @application.exception_handler(AIServiceError)
    async def handle_ai_service_error(
        request: Request, exc: AIServiceError
    ) -> JSONResponse:
        request_id = exc.request_id or request.headers.get("X-Request-Id")
        body = ErrorResponse(
            error=ErrorDetail(
                code=exc.code,
                message=exc.message,
                request_id=request_id,
                retryable=exc.retryable,
            )
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=body.model_dump(mode="json", by_alias=True),
        )

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        request_id = exc.body.get("request_id") if isinstance(exc.body, dict) else None
        body = ErrorResponse(
            error=ErrorDetail(
                code="INVALID_INVOCATION_REQUEST",
                message="Request validation failed",
                request_id=request_id,
                retryable=False,
            )
        )
        return JSONResponse(
            status_code=422,
            content=body.model_dump(mode="json", by_alias=True),
        )

    @application.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unexpected ai-service error", exc_info=exc)
        body = ErrorResponse(
            error=ErrorDetail(
                code="INTERNAL_ERROR",
                message="An unexpected internal error occurred",
                request_id=None,
                retryable=False,
            )
        )
        return JSONResponse(
            status_code=500,
            content=body.model_dump(mode="json", by_alias=True),
        )

    return application


app = create_app()
