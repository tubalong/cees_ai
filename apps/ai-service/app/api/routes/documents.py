from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response

from app.api.generated.models import (
    ComposeDocumentRequest,
    ComposeDocumentResponse,
    ErrorResponse,
    ExecutionMetadata,
    Provider,
    RenderDocxRequest,
    TokenUsage,
)
from app.core.errors import AIServiceError
from app.core.runtime import AppRuntime
from app.core.security import require_internal_token
from app.documents.composer import DocumentComposer, DocumentComposition
from app.documents.docx_renderer import (
    DOCX_MEDIA_TYPE,
    DocxRenderer,
    RenderedDocx,
    content_disposition,
)
from app.llm.router import LLMRouter, RoutingResult

router = APIRouter(
    prefix="/internal/v1/documents",
    tags=["documents"],
    dependencies=[Depends(require_internal_token)],
)

LLM_ERROR_RESPONSES = {
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
RENDER_ERROR_RESPONSES = {
    401: LLM_ERROR_RESPONSES[401],
    422: LLM_ERROR_RESPONSES[422],
    500: LLM_ERROR_RESPONSES[500],
}
DOCX_HEADERS = {
    "Cache-Control": {"schema": {"type": "string", "const": "no-store"}},
    "Content-Disposition": {
        "description": "Attachment filename with ASCII fallback and RFC 5987 UTF-8 filename.",
        "schema": {"type": "string"},
    },
    "X-Request-Id": {"schema": {"type": "string"}},
}
DOCX_RESPONSE = {
    "description": "DOCX document rendered",
    "headers": DOCX_HEADERS,
    "content": {
        DOCX_MEDIA_TYPE: {
            "schema": {"type": "string", "format": "binary"},
        }
    },
}


@router.post(
    "/compose",
    response_model=ComposeDocumentResponse,
    operation_id="composeDocument",
    summary="Compose a structured document draft",
    response_description="Document draft composed",
    responses=LLM_ERROR_RESPONSES,
)
async def compose_document(
    payload: ComposeDocumentRequest, request: Request
) -> ComposeDocumentResponse:
    composition = await DocumentComposer(_require_router(request, payload.request_id)).compose(
        payload
    )
    return ComposeDocumentResponse(
        request_id=payload.request_id,
        document=composition.document,
        execution=_execution_metadata(composition.routing),
    )


@router.post(
    "/render-docx",
    response_class=Response,
    response_model=None,
    operation_id="renderDocumentDocx",
    summary="Render a DocumentSpec as DOCX",
    response_description="DOCX document rendered",
    responses={200: DOCX_RESPONSE, **RENDER_ERROR_RESPONSES},
)
async def render_document_docx(payload: RenderDocxRequest) -> Response:
    rendered = DocxRenderer().render(
        payload.document,
        payload.document_options,
        request_id=payload.request_id,
    )
    return _docx_response(rendered, payload.request_id)


@router.post(
    "/generate-docx",
    response_class=Response,
    response_model=None,
    operation_id="generateDocumentDocx",
    summary="Compose and render a DOCX document",
    response_description="DOCX document generated",
    responses={
        200: {
            **DOCX_RESPONSE,
            "description": "DOCX document generated",
            "headers": {
                **DOCX_HEADERS,
                "X-AI-Profile": {"schema": {"type": "string"}},
                "X-AI-Model": {"schema": {"type": "string"}},
                "X-AI-Finish-Reason": {"schema": {"type": "string"}},
            },
        },
        **LLM_ERROR_RESPONSES,
    },
)
async def generate_document_docx(
    payload: ComposeDocumentRequest, request: Request
) -> Response:
    composition = await DocumentComposer(_require_router(request, payload.request_id)).compose(
        payload
    )
    rendered = DocxRenderer().render(
        composition.document,
        payload.document_options,
        request_id=payload.request_id,
    )
    return _docx_response(rendered, payload.request_id, composition)


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


def _docx_response(
    rendered: RenderedDocx,
    request_id: str,
    composition: DocumentComposition | None = None,
) -> Response:
    headers = {
        "Cache-Control": "no-store",
        "Content-Disposition": content_disposition(rendered.filename),
        "X-Request-Id": _header_value(request_id),
    }
    if composition is not None:
        routing = composition.routing
        headers["X-AI-Profile"] = _header_value(routing.profile_name)
        headers["X-AI-Model"] = _header_value(routing.profile.model)
        if routing.provider_result.finish_reason is not None:
            headers["X-AI-Finish-Reason"] = _header_value(
                routing.provider_result.finish_reason
            )
    return Response(
        content=rendered.content,
        media_type=DOCX_MEDIA_TYPE,
        headers=headers,
    )


def _header_value(value: str) -> str:
    return quote(value, safe="-._~")