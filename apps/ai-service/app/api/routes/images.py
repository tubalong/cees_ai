from __future__ import annotations

import base64
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from app.api.generated.models import (
    ContentType,
    ErrorResponse,
    ImageEditRequest,
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
from app.images.types import ImageRoutingResult

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

MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024


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
    return _image_response(payload.request_id, routed)


@router.post(
    "/edit",
    response_model=ImageGenerateResponse,
    operation_id="editImage",
    summary="Edit an image while preserving the source image",
    response_description="Image edited",
    responses=IMAGE_ERROR_RESPONSES,
)
async def edit_image(
    payload: ImageEditRequest, request: Request
) -> ImageGenerateResponse:
    image_router = _require_image_router(request, payload.request_id)
    source_image = _decode_source_image(payload)
    routed = await image_router.edit(
        request_id=payload.request_id,
        prompt=payload.prompt,
        source_image=source_image,
        size=payload.size if payload.size is not None else "1024x1024",
        quality=payload.quality.value if payload.quality is not None else "standard",
        response_format=(
            payload.response_format.value
            if payload.response_format is not None
            else "png"
        ),
        input_fidelity=(
            payload.input_fidelity.value
            if payload.input_fidelity is not None
            else "high"
        ),
    )
    return _image_response(payload.request_id, routed)


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


def _decode_source_image(payload: ImageEditRequest) -> bytes:
    normalized = "".join(payload.source_image_base64.split())
    try:
        source_image = base64.b64decode(normalized, validate=True)
    except Exception as exc:
        raise AIServiceError(
            "INVALID_IMAGE_EDIT_REQUEST",
            "source_image_base64 is not valid base64",
            status_code=422,
            request_id=payload.request_id,
        ) from exc

    if not source_image:
        raise AIServiceError(
            "INVALID_IMAGE_EDIT_REQUEST",
            "source_image_base64 decoded to an empty image",
            status_code=422,
            request_id=payload.request_id,
        )

    if len(source_image) > MAX_SOURCE_IMAGE_BYTES:
        raise AIServiceError(
            "IMAGE_EDIT_INPUT_TOO_LARGE",
            "Source image exceeds the 10 MiB limit",
            status_code=422,
            request_id=payload.request_id,
        )

    return source_image


def _image_response(request_id: str, routed: ImageRoutingResult) -> ImageGenerateResponse:
    dimensions = image_dimensions(routed.data)
    width, height = dimensions if dimensions is not None else (None, None)
    return ImageGenerateResponse(
        request_id=request_id,
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
