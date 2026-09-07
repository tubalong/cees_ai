from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.generated.models import (
    ContentDeltaEvent,
    ErrorDetail,
    ErrorResponse,
    Provider,
    StreamCompletedEvent,
    StreamErrorEvent,
    StreamExecutionMetadata,
    StreamRequest,
    StreamStartedEvent,
    TokenUsage,
    UsageEvent,
)
from app.api.request_validation import validate_message_content_size
from app.core.config import ModelRole
from app.core.errors import AIServiceError, ProviderPermanentError, ProviderTransientError
from app.core.runtime import AppRuntime
from app.core.security import require_internal_token
from app.llm.router import StreamingRoutingResult
from app.llm.types import ChatMessage, TokenUsageData

logger = logging.getLogger(__name__)
StreamEvent = (
    StreamStartedEvent
    | ContentDeltaEvent
    | UsageEvent
    | StreamCompletedEvent
    | StreamErrorEvent
)

router = APIRouter(
    prefix="/internal/v1/llm",
    tags=["llm"],
    dependencies=[Depends(require_internal_token)],
)


@router.post(
    "/stream",
    response_class=StreamingResponse,
    response_model=None,
    operation_id="streamLlm",
    summary="Stream a configured LLM profile",
    response_description="Invocation events are streamed",
    responses={
        400: {
            "model": ErrorResponse,
            "description": "Invalid profile or unsupported output mode",
        },
        401: {
            "model": ErrorResponse,
            "description": "Internal authentication failed",
        },
        422: {
            "model": ErrorResponse,
            "description": "Request validation failed",
        },
        500: {
            "model": ErrorResponse,
            "description": "Unexpected internal service error",
        },
        502: {
            "model": ErrorResponse,
            "description": "Provider output did not match the requested schema",
        },
        503: {
            "model": ErrorResponse,
            "description": "Service or configured providers unavailable",
        },
    },
)
async def stream_llm(payload: StreamRequest, request: Request) -> StreamingResponse:
    runtime: AppRuntime = request.app.state.runtime
    if not runtime.ready or runtime.router is None:
        raise AIServiceError(
            "AI_SERVICE_NOT_READY",
            "AI service configuration is not ready",
            status_code=503,
            retryable=True,
            request_id=payload.request_id,
        )

    validate_message_content_size(payload.messages, payload.request_id)
    role = ModelRole(payload.role.value) if payload.role is not None else ModelRole.default
    routed = await runtime.router.start_stream(
        request_id=payload.request_id,
        tenant_id=payload.tenant_id,
        user_id=payload.user_id,
        messages=[
            ChatMessage(role=message.role.value, content=message.content)
            for message in payload.messages
        ],
        role=role,
        profile_override=payload.llm_profile,
        temperature=payload.temperature,
        max_output_tokens=payload.max_output_tokens,
    )

    return StreamingResponse(
        _stream_events(payload, routed),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _stream_events(
    payload: StreamRequest,
    routed: StreamingRoutingResult,
) -> AsyncIterator[str]:
    yield _encode_sse(
        StreamStartedEvent(
            type="started",
            request_id=payload.request_id,
            execution=StreamExecutionMetadata(
                profile=routed.profile_name,
                provider=Provider(routed.profile.provider),
                model=routed.profile.model,
                fallback_count=routed.fallback_count,
            ),
        )
    )
    token_usage: TokenUsageData | None = None
    try:
        async for chunk in routed.chunks:
            if chunk.text:
                yield _encode_sse(ContentDeltaEvent(type="content_delta", text=chunk.text))
            if chunk.token_usage is not None:
                token_usage = chunk.token_usage
    except ProviderTransientError:
        logger.warning(
            "llm stream interrupted by transient provider failure",
            extra={"request_id": payload.request_id, "profile": routed.profile_name},
        )
        yield _encode_stream_error(
            request_id=payload.request_id,
            code="LLM_STREAM_INTERRUPTED",
            message="The provider stream was interrupted",
            retryable=True,
        )
        return
    except ProviderPermanentError:
        logger.warning(
            "llm stream terminated by provider rejection",
            extra={"request_id": payload.request_id, "profile": routed.profile_name},
        )
        yield _encode_stream_error(
            request_id=payload.request_id,
            code="LLM_STREAM_FAILED",
            message="The provider terminated the invocation stream",
            retryable=False,
        )
        return
    except Exception as exc:
        logger.exception(
            "unexpected llm stream failure",
            exc_info=exc,
            extra={"request_id": payload.request_id, "profile": routed.profile_name},
        )
        yield _encode_stream_error(
            request_id=payload.request_id,
            code="INTERNAL_ERROR",
            message="An unexpected internal error occurred",
            retryable=False,
        )
        return

    if token_usage is not None:
        yield _encode_sse(
            UsageEvent(
                type="usage",
                token_usage=TokenUsage(
                    input_tokens=token_usage.input_tokens,
                    output_tokens=token_usage.output_tokens,
                    total_tokens=token_usage.total_tokens,
                ),
            )
        )
    latency_ms = round((time.perf_counter() - routed.started_at) * 1000)
    yield _encode_sse(StreamCompletedEvent(type="completed", latency_ms=latency_ms))
    logger.info(
        "llm stream completed",
        extra={
            "request_id": payload.request_id,
            "tenant_id": payload.tenant_id,
            "user_id": payload.user_id,
            "profile": routed.profile_name,
            "provider": routed.profile.provider,
            "model": routed.profile.model,
            "fallback_count": routed.fallback_count,
            "latency_ms": latency_ms,
            "input_tokens": token_usage.input_tokens if token_usage else None,
            "output_tokens": token_usage.output_tokens if token_usage else None,
            "total_tokens": token_usage.total_tokens if token_usage else None,
        },
    )


def _encode_stream_error(
    *, request_id: str, code: str, message: str, retryable: bool
) -> str:
    return _encode_sse(
        StreamErrorEvent(
            type="error",
            error=ErrorDetail(
                code=code,
                message=message,
                request_id=request_id,
                retryable=retryable,
            ),
        )
    )


def _encode_sse(event: StreamEvent) -> str:
    return f"event: {event.type}\ndata: {event.model_dump_json(by_alias=True)}\n\n"