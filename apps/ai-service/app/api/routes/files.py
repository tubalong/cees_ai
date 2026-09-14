from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, Request

from app.api.generated.models import (
    ErrorResponse,
    FileExtractionMetadata,
    FileExtractionRequest,
    FileExtractionResponse,
    TextContentPart,
)
from app.core.config import ExtractionConfig
from app.core.errors import AIServiceError
from app.core.runtime import AppRuntime
from app.core.security import require_internal_token
from app.extraction import ExtractionFailedError, UnsupportedFileTypeError, extract_text

router = APIRouter(
    prefix="/internal/v1/files",
    tags=["files"],
    dependencies=[Depends(require_internal_token)],
)

FILES_ERROR_RESPONSES = {
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
}


@router.post(
    "/extract",
    response_model=FileExtractionResponse,
    operation_id="extractFile",
    summary="Extract plain text from a document",
    response_description="Text extracted",
    responses=FILES_ERROR_RESPONSES,
)
async def extract_file(payload: FileExtractionRequest, request: Request) -> FileExtractionResponse:
    config = _extraction_config(request)
    data = _decode_source_file(payload, config.max_bytes)
    try:
        result = extract_text(
            content_type=payload.content_type,
            data=data,
            filename=payload.filename,
        )
    except UnsupportedFileTypeError as exc:
        raise AIServiceError(
            "UNSUPPORTED_FILE_TYPE",
            f"Unsupported file type: {exc.content_type}",
            status_code=422,
            request_id=payload.request_id,
        ) from exc
    except ExtractionFailedError as exc:
        raise AIServiceError(
            "EXTRACTION_FAILED",
            f"File extraction failed: {exc.message}",
            status_code=422,
            request_id=payload.request_id,
        ) from exc

    return FileExtractionResponse(
        request_id=payload.request_id,
        parts=_text_parts(result.text, config.max_part_text_chars),
        metadata=FileExtractionMetadata(
            content_type=payload.content_type,
            engine=result.engine,
            text_length=len(result.text),
        ),
    )


def _extraction_config(request: Request) -> ExtractionConfig:
    runtime: AppRuntime = request.app.state.runtime
    if runtime.catalog is not None and runtime.catalog.extraction is not None:
        return runtime.catalog.extraction
    return ExtractionConfig()


def _decode_source_file(payload: FileExtractionRequest, max_bytes: int) -> bytes:
    normalized = "".join(payload.data_base64.split())
    try:
        data = base64.b64decode(normalized, validate=True)
    except Exception as exc:
        raise AIServiceError(
            "INVALID_FILE_EXTRACTION_REQUEST",
            "data_base64 is not valid base64",
            status_code=422,
            request_id=payload.request_id,
        ) from exc

    if not data:
        raise AIServiceError(
            "INVALID_FILE_EXTRACTION_REQUEST",
            "data_base64 decoded to an empty file",
            status_code=422,
            request_id=payload.request_id,
        )

    if len(data) > max_bytes:
        raise AIServiceError(
            "FILE_TOO_LARGE",
            f"Source file exceeds the {max_bytes} byte limit",
            status_code=422,
            request_id=payload.request_id,
        )

    return data


def _text_parts(text: str, max_part_text_chars: int) -> list[TextContentPart]:
    return [
        TextContentPart(type="text", text=text[index : index + max_part_text_chars])
        for index in range(0, len(text), max_part_text_chars)
        if text[index : index + max_part_text_chars]
    ]
