from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.generated.models import (
    ErrorResponse,
    ImageGenerateRequest,
    ImageGenerateResponse,
)
from app.core.errors import AIServiceError
from app.core.security import require_internal_token

router = APIRouter(
    prefix="/internal/v1/images",
    tags=["images"],
    dependencies=[Depends(require_internal_token)],
)

IMAGE_ERROR_RESPONSES = {
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
    "/generate",
    response_model=ImageGenerateResponse,
    operation_id="generateImage",
    summary="Generate an image through a configured image-capable model",
    response_description="Image generated",
    responses=IMAGE_ERROR_RESPONSES,
)
async def generate_image(
    payload: ImageGenerateRequest, request: Request
) -> ImageGenerateResponse:
    raise AIServiceError(
        "NOT_IMPLEMENTED",
        "Image generation is not implemented",
        status_code=501,
        request_id=payload.request_id,
    )
