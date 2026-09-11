from __future__ import annotations

import base64
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from app.api.generated.models import (
    ContentType,
    ErrorResponse,
    ImageGenerateRequest,
    ImageGenerateResponse,
    ImageGenerationMetadata,
    ImageProvider,
    TokenUsage,
)
from app.core.errors import AIServiceError
from app.core.runtime import AppRuntime
from app.core.security import require_internal_token, require_preview_token
from app.images.dimensions import image_dimensions
from app.images.router import ImageRouter

router = APIRouter(
    prefix="/internal/v1/images",
    tags=["images"],
    dependencies=[Depends(require_internal_token)],
)

preview_router = APIRouter(
    prefix="/internal/v1/images",
    tags=["images"],
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

PREVIEW_RESPONSE = {
    "description": "Generated image bytes",
    "content": {
        "image/png": {"schema": {"type": "string", "format": "binary"}},
        "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
        "image/webp": {"schema": {"type": "string", "format": "binary"}},
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
    image_router = _require_image_router(request, payload.request_id)
    routed = await image_router.generate(
        request_id=payload.request_id,
        prompt=payload.prompt,
        size=payload.size if payload.size is not None else "1024x1024",
        quality=payload.quality.value if payload.quality is not None else "standard",
        response_format=(
            payload.response_format.value
            if payload.response_format is not None
            else "png"
        ),
    )
    dimensions = image_dimensions(routed.data)
    width, height = dimensions if dimensions is not None else (None, None)
    return ImageGenerateResponse(
        request_id=payload.request_id,
        content_type=_content_type_enum(routed.content_type),
        data_base64=base64.b64encode(routed.data).decode("ascii"),
        execution=ImageGenerationMetadata(
            profile=routed.profile_name,
            provider=ImageProvider(routed.profile.provider),
            model=routed.profile.model,
            fallback_count=routed.fallback_count,
            latency_ms=routed.latency_ms,
            width=width,
            height=height,
            token_usage=TokenUsage(
                input_tokens=None,
                output_tokens=None,
                total_tokens=None,
            ),
        ),
    )


@preview_router.get(
    "/preview",
    response_class=Response,
    response_model=None,
    operation_id="previewImage",
    summary="Preview a generated image as raw bytes",
    response_description="Generated image bytes",
    responses={200: PREVIEW_RESPONSE, **IMAGE_ERROR_RESPONSES},
)
async def preview_image(
    request: Request,
    prompt: Annotated[str, Query(min_length=1, max_length=8000)],
    size: Annotated[
        str, Query(pattern=r"^(auto|[1-9][0-9]*x[1-9][0-9]*)$")
    ] = "1024x1024",
    quality: Literal["standard", "high"] = "standard",
    response_format: Literal["png", "jpeg", "webp"] = "png",
    _: None = Depends(require_preview_token),
) -> Response:
    request_id = f"preview-{uuid.uuid4().hex[:8]}"
    image_router = _require_image_router(request, request_id)
    routed = await image_router.generate(
        request_id=request_id,
        prompt=prompt,
        size=size,
        quality=quality,
        response_format=response_format,
    )
    return Response(content=routed.data, media_type=routed.content_type)


def _require_image_router(request: Request, request_id: str) -> ImageRouter:
    runtime: AppRuntime = request.app.state.runtime
    if runtime.image_router is None:
        raise AIServiceError(
            "AI_SERVICE_NOT_READY",
            "Image generation configuration is not ready",
            status_code=503,
            retryable=True,
            request_id=request_id,
        )
    return runtime.image_router


def _content_type_enum(value: str) -> ContentType:
    if value == "image/jpeg":
        return ContentType.image_jpeg
    if value == "image/webp":
        return ContentType.image_webp
    return ContentType.image_png
