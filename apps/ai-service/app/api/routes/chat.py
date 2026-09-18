from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.generated.models import (
    ChatAssistantMessage,
    ChatContextStrategy,
    ChatContextUsage,
    ChatInvokeResponse,
    ChatMode,
    ChatRequest,
    ChatStreamCompletedEvent,
    ChatStreamPhase,
    ChatStreamStartedEvent,
    ChatStreamStatusEvent,
    CompactChatRequest,
    CompactChatResponse,
    ContentDeltaEvent,
    ErrorDetail,
    ErrorResponse,
    ExecutionMetadata,
    Provider,
    StreamErrorEvent,
    StreamExecutionMetadata,
    TokenUsage,
    ToolTurnRequest,
    ToolTurnToolCallsEvent,
    UsageEvent,
)
from app.api.generated.models import (
    ToolCall as ApiToolCall,
)
from app.chat.compactor import ChatCompactor
from app.chat.orchestrator import ChatOrchestrator, PreparedChat
from app.chat.tool_turn import PreparedToolTurn, ToolTurnOrchestrator
from app.core.config import ModelProfile
from app.core.errors import (
    AIServiceError,
    ProviderPermanentError,
    ProviderTransientError,
    describe_provider_rejection,
)
from app.core.runtime import AppRuntime
from app.core.security import require_internal_token
from app.llm.router import LLMRouter, RoutingResult
from app.llm.types import TokenUsageData

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/v1/chat",
    tags=["chat"],
    dependencies=[Depends(require_internal_token)],
)

CHAT_ERROR_RESPONSES = {
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
}


@router.post(
    "/invoke",
    response_model=ChatInvokeResponse,
    operation_id="invokeChat",
    summary="Generate a contextual chat response",
    response_description="Chat response generated",
    responses=CHAT_ERROR_RESPONSES,
)
async def invoke_chat(payload: ChatRequest, request: Request) -> ChatInvokeResponse:
    orchestrator = ChatOrchestrator(_require_router(request, payload.request_id))
    invocation = await orchestrator.invoke(payload)
    output = invocation.routing.provider_result.output
    assert isinstance(output, str)
    return ChatInvokeResponse(
        request_id=payload.request_id,
        conversation_id=payload.conversation_id,
        mode=ChatMode(invocation.mode.value),
        message=ChatAssistantMessage(role="assistant", content=output),
        context_usage=invocation.context_usage,
        execution=_execution_metadata(invocation.routing),
    )


@router.post(
    "/compact",
    response_model=CompactChatResponse,
    operation_id="compactChat",
    summary="Compact conversation history into a reusable summary",
    response_description="Conversation history compacted",
    responses=CHAT_ERROR_RESPONSES,
)
async def compact_chat(payload: CompactChatRequest, request: Request) -> CompactChatResponse:
    compaction = await ChatCompactor(_require_router(request, payload.request_id)).compact(payload)
    return CompactChatResponse(
        request_id=payload.request_id,
        conversation_id=payload.conversation_id,
        summary=compaction.summary,
        summarized_through_message_id=compaction.summarized_through_message_id,
        execution=_execution_metadata(compaction.routing),
    )


@router.post(
    "/stream",
    response_class=StreamingResponse,
    response_model=None,
    operation_id="streamChat",
    summary="Stream a contextual chat response",
    response_description="Chat response events are streamed",
    responses=CHAT_ERROR_RESPONSES,
)
async def stream_chat(payload: ChatRequest, request: Request) -> StreamingResponse:
    llm_router = _require_router(request, payload.request_id)
    orchestrator = ChatOrchestrator(llm_router)
    prepared = orchestrator.prepare(payload)
    return StreamingResponse(
        _chat_stream_events(payload, prepared, llm_router),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/tool-turn/stream",
    response_class=StreamingResponse,
    response_model=None,
    operation_id="streamChatToolTurn",
    summary="Stream a single tool-capable chat turn",
    response_description="Tool-capable turn events are streamed",
    responses=CHAT_ERROR_RESPONSES,
)
async def stream_chat_tool_turn(
    payload: ToolTurnRequest, request: Request
) -> StreamingResponse:
    llm_router = _require_router(request, payload.request_id)
    prepared = ToolTurnOrchestrator().prepare(payload)
    return StreamingResponse(
        _tool_turn_stream_events(payload, prepared, llm_router),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _tool_turn_stream_events(
    payload: ToolTurnRequest,
    prepared: PreparedToolTurn,
    llm_router: LLMRouter,
) -> AsyncIterator[str]:
    yield _encode_sse(
        ChatStreamStartedEvent(
            type="started",
            request_id=payload.request_id,
            conversation_id=payload.conversation_id,
            mode=ChatMode(prepared.mode.value),
            context_usage=ChatContextUsage(
                strategy=ChatContextStrategy.full,
                received_message_count=prepared.received_message_count,
                included_message_count=prepared.included_message_count,
                history_truncated=False,
                estimated_input_tokens=prepared.estimated_input_tokens,
            ),
        )
    )

    try:
        routed = await llm_router.start_tool_stream(
            request_id=payload.request_id,
            tenant_id=payload.tenant_id,
            user_id=payload.user_id,
            messages=prepared.messages,
            tools=prepared.tools,
            profile_override=None,
            temperature=None,
            max_output_tokens=prepared.max_output_tokens,
        )
    except AIServiceError as exc:
        yield _encode_stream_error(
            request_id=payload.request_id,
            code=exc.code,
            message=exc.message,
            retryable=exc.retryable,
        )
        return
    except Exception as exc:
        logger.exception(
            "unexpected tool turn stream startup failure",
            exc_info=exc,
            extra={"request_id": payload.request_id},
        )
        yield _encode_stream_error(
            request_id=payload.request_id,
            code="INTERNAL_ERROR",
            message="An unexpected internal error occurred",
            retryable=False,
        )
        return

    yield _encode_sse(
        ChatStreamStatusEvent(
            type="status",
            phase=ChatStreamPhase.answering,
            execution=_stream_execution_metadata(
                routed.profile_name, routed.profile, routed.fallback_count
            ),
        )
    )

    token_usage: TokenUsageData | None = None
    finish_reason: str | None = None
    try:
        async for chunk in routed.chunks:
            if chunk.text:
                yield _encode_sse(ContentDeltaEvent(type="content_delta", text=chunk.text))
            if chunk.tool_calls:
                yield _encode_sse(
                    ToolTurnToolCallsEvent(
                        type="tool_calls",
                        tool_calls=[
                            ApiToolCall(
                                id=tool_call.id,
                                name=tool_call.name,
                                arguments=tool_call.arguments,
                            )
                            for tool_call in chunk.tool_calls
                        ],
                    )
                )
            if chunk.token_usage is not None:
                token_usage = chunk.token_usage
            if chunk.finish_reason is not None:
                finish_reason = chunk.finish_reason
    except ProviderTransientError:
        yield _encode_stream_error(
            request_id=payload.request_id,
            code="CHAT_STREAM_INTERRUPTED",
            message="The provider tool turn stream was interrupted",
            retryable=True,
        )
        return
    except ProviderPermanentError as exc:
        rejection = describe_provider_rejection(
            exc,
            profile=routed.profile_name,
            provider=routed.profile.provider,
            model=routed.profile.model,
            api_key_env=routed.profile.api_key_env,
        )
        logger.warning(
            "llm tool turn stream terminated by provider rejection",
            extra={
                "request_id": payload.request_id,
                "profile": routed.profile_name,
                "upstream_status": exc.status_code,
                "error_code": rejection.code,
            },
        )
        yield _encode_stream_error(
            request_id=payload.request_id,
            code=rejection.code,
            message=rejection.message,
            retryable=rejection.retryable,
        )
        return
    except Exception as exc:
        logger.exception(
            "unexpected tool turn stream failure",
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
    yield _encode_sse(
        ChatStreamCompletedEvent(
            type="completed",
            latency_ms=latency_ms,
            finish_reason=finish_reason,
        )
    )
    logger.info(
        "tool turn stream completed",
        extra={
            "request_id": payload.request_id,
            "tenant_id": payload.tenant_id,
            "user_id": payload.user_id,
            "conversation_id": payload.conversation_id,
            "chat_mode": prepared.mode.value,
            "profile": routed.profile_name,
            "provider": routed.profile.provider,
            "model": routed.profile.model,
            "fallback_count": routed.fallback_count,
            "latency_ms": latency_ms,
            "finish_reason": finish_reason,
            "input_tokens": token_usage.input_tokens if token_usage else None,
            "output_tokens": token_usage.output_tokens if token_usage else None,
            "total_tokens": token_usage.total_tokens if token_usage else None,
        },
    )


async def _chat_stream_events(
    payload: ChatRequest,
    prepared: PreparedChat,
    llm_router: LLMRouter,
) -> AsyncIterator[str]:
    yield _encode_sse(
        ChatStreamStartedEvent(
            type="started",
            request_id=payload.request_id,
            conversation_id=payload.conversation_id,
            mode=ChatMode(prepared.mode.value),
            context_usage=prepared.context.usage,
        )
    )
    if prepared.policy.emit_reasoning_status and prepared.policy.reasoning_effort is not None:
        yield _encode_sse(ChatStreamStatusEvent(type="status", phase=ChatStreamPhase.reasoning))

    try:
        routed = await llm_router.start_stream(
            request_id=payload.request_id,
            tenant_id=payload.tenant_id,
            user_id=payload.user_id,
            messages=prepared.context.messages,
            role=prepared.policy.role,
            profile_override=None,
            temperature=None,
            max_output_tokens=prepared.max_output_tokens,
            reasoning_effort=prepared.policy.reasoning_effort,
        )
    except AIServiceError as exc:
        yield _encode_stream_error(
            request_id=payload.request_id,
            code=exc.code,
            message=exc.message,
            retryable=exc.retryable,
        )
        return
    except Exception as exc:
        logger.exception(
            "unexpected chat stream startup failure",
            exc_info=exc,
            extra={"request_id": payload.request_id},
        )
        yield _encode_stream_error(
            request_id=payload.request_id,
            code="INTERNAL_ERROR",
            message="An unexpected internal error occurred",
            retryable=False,
        )
        return

    yield _encode_sse(
        ChatStreamStatusEvent(
            type="status",
            phase=ChatStreamPhase.answering,
            execution=_stream_execution_metadata(
                routed.profile_name, routed.profile, routed.fallback_count
            ),
        )
    )

    token_usage: TokenUsageData | None = None
    finish_reason: str | None = None
    try:
        async for chunk in routed.chunks:
            if chunk.text:
                yield _encode_sse(ContentDeltaEvent(type="content_delta", text=chunk.text))
            if chunk.token_usage is not None:
                token_usage = chunk.token_usage
            if chunk.finish_reason is not None:
                finish_reason = chunk.finish_reason
    except ProviderTransientError:
        yield _encode_stream_error(
            request_id=payload.request_id,
            code="CHAT_STREAM_INTERRUPTED",
            message="The provider chat stream was interrupted",
            retryable=True,
        )
        return
    except ProviderPermanentError as exc:
        rejection = describe_provider_rejection(
            exc,
            profile=routed.profile_name,
            provider=routed.profile.provider,
            model=routed.profile.model,
            api_key_env=routed.profile.api_key_env,
        )
        logger.warning(
            "llm chat stream terminated by provider rejection",
            extra={
                "request_id": payload.request_id,
                "profile": routed.profile_name,
                "upstream_status": exc.status_code,
                "error_code": rejection.code,
            },
        )
        yield _encode_stream_error(
            request_id=payload.request_id,
            code=rejection.code,
            message=rejection.message,
            retryable=rejection.retryable,
        )
        return
    except Exception as exc:
        logger.exception(
            "unexpected chat stream failure",
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
    yield _encode_sse(
        ChatStreamCompletedEvent(
            type="completed",
            latency_ms=latency_ms,
            finish_reason=finish_reason,
        )
    )
    logger.info(
        "chat stream completed",
        extra={
            "request_id": payload.request_id,
            "tenant_id": payload.tenant_id,
            "user_id": payload.user_id,
            "conversation_id": payload.conversation_id,
            "chat_mode": prepared.mode.value,
            "profile": routed.profile_name,
            "provider": routed.profile.provider,
            "model": routed.profile.model,
            "fallback_count": routed.fallback_count,
            "latency_ms": latency_ms,
            "finish_reason": finish_reason,
            "input_tokens": token_usage.input_tokens if token_usage else None,
            "output_tokens": token_usage.output_tokens if token_usage else None,
            "total_tokens": token_usage.total_tokens if token_usage else None,
        },
    )


def _require_router(request: Request, request_id: str) -> LLMRouter:
    runtime: AppRuntime = request.app.state.runtime
    if not runtime.ready or runtime.router is None:
        raise AIServiceError(
            "AI_SERVICE_NOT_READY",
            "AI service configuration is not ready",
            status_code=503,
            retryable=True,
            request_id=request_id,
        )
    return runtime.router


def _execution_metadata(routing: RoutingResult) -> ExecutionMetadata:
    usage = routing.provider_result.token_usage
    return ExecutionMetadata(
        profile=routing.profile_name,
        provider=Provider(routing.profile.provider),
        model=routing.profile.model,
        fallback_count=routing.fallback_count,
        latency_ms=routing.latency_ms,
        finish_reason=routing.provider_result.finish_reason,
        token_usage=TokenUsage(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            total_tokens=usage.total_tokens,
        ),
    )


def _stream_execution_metadata(
    profile_name: str, profile: ModelProfile, fallback_count: int
) -> StreamExecutionMetadata:
    return StreamExecutionMetadata(
        profile=profile_name,
        provider=Provider(profile.provider),
        model=profile.model,
        fallback_count=fallback_count,
    )


def _encode_stream_error(*, request_id: str, code: str, message: str, retryable: bool) -> str:
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


def _encode_sse(event: BaseModel) -> str:
    event_type = event.type
    return f"event: {event_type}\ndata: {event.model_dump_json(by_alias=True)}\n\n"
