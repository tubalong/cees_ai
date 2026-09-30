from __future__ import annotations

import base64
from typing import Any

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI, RateLimitError

from app.core.config import ImageProfile
from app.core.errors import ProviderPermanentError, ProviderTransientError
from app.images.types import GeneratedImage, ImageProvider

_CONTENT_TYPES = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}

# 部分 OpenAI 兼容服务（如硅基流动）忽略 `response_format`，只在响应里给出一个
# 短期有效的图片 URL；服务端取回字节后，调用方仍然只面对"图片字节"一种形态。
# 上限与文档插图取图（app/documents/images.py）保持同一数量级，避免异常响应打满内存。
_MAX_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024

# 上游没有 OpenAI 的 `images.edit` 端点时返回的状态码（硅基流动为 404）。
_MISSING_EDIT_ENDPOINT_STATUS = frozenset({404, 405})


class MockImageProvider:
    def __init__(self, profile: ImageProfile) -> None:
        self.profile = profile

    async def generate(
        self,
        *,
        prompt: str,
        size: str,
        quality: str,
        response_format: str,
    ) -> GeneratedImage:
        return GeneratedImage(
            content_type=_content_type(response_format),
            data=b"mock-image-bytes",
        )

    async def edit(
        self,
        *,
        prompt: str,
        source_image: bytes,
        size: str,
        quality: str,
        response_format: str,
        input_fidelity: str,
    ) -> GeneratedImage:
        return GeneratedImage(
            content_type=_content_type(response_format),
            data=b"mock-edited-image-bytes",
        )


class OpenAICompatibleImageProvider:
    def __init__(self, profile: ImageProfile, api_key: str) -> None:
        self.profile = profile
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=profile.base_url,
            timeout=profile.timeout_seconds,
            max_retries=profile.max_retries,
        )

    async def generate(
        self,
        *,
        prompt: str,
        size: str,
        quality: str,
        response_format: str,
    ) -> GeneratedImage:
        try:
            result = await self.client.images.generate(
                model=self.profile.model,
                prompt=prompt,
                size=size,
                quality=quality,
                response_format="b64_json",
            )
            return await self._materialise(
                result, response_format=response_format, operation="generate"
            )
        except Exception as exc:
            raise _map_provider_error(exc) from exc

    async def edit(
        self,
        *,
        prompt: str,
        source_image: bytes,
        size: str,
        quality: str,
        response_format: str,
        input_fidelity: str,
    ) -> GeneratedImage:
        try:
            result = await self.client.images.edit(
                model=self.profile.model,
                image=source_image,
                prompt=prompt,
                size=size,
                quality=quality,
                response_format="b64_json",
                input_fidelity=input_fidelity,
            )
        except APIStatusError as exc:
            if exc.status_code not in _MISSING_EDIT_ENDPOINT_STATUS:
                raise _map_provider_error(exc) from exc
            return await self._edit_via_generation(
                prompt=prompt,
                source_image=source_image,
                size=size,
                quality=quality,
                response_format=response_format,
            )
        except Exception as exc:
            raise _map_provider_error(exc) from exc

        try:
            return await self._materialise(
                result, response_format=response_format, operation="edit"
            )
        except Exception as exc:
            raise _map_provider_error(exc) from exc

    async def _edit_via_generation(
        self,
        *,
        prompt: str,
        source_image: bytes,
        size: str,
        quality: str,
        response_format: str,
    ) -> GeneratedImage:
        """用多模态入参改图：`/images/generations` + `image=<data URL>`。

        上游没有 OpenAI 的 `images.edit` 端点时（如硅基流动）走这条路径，
        由模型（如 Qwen-Image-Edit 这类图生图模型）同时接收文本与源图。
        `input_fidelity` 是 OpenAI 编辑接口的专有参数，这里不发送。
        """
        media_type = _content_type_from_bytes(source_image) or _CONTENT_TYPES["png"]
        encoded_source = base64.b64encode(source_image).decode("ascii")
        try:
            result = await self.client.images.generate(
                model=self.profile.model,
                prompt=prompt,
                size=size,
                quality=quality,
                response_format="b64_json",
                # `image` 不是 OpenAI Images 的标准字段，通过 extra_body 透传，
                # 避免 SDK 因未知参数直接拒绝。
                extra_body={"image": f"data:{media_type};base64,{encoded_source}"},
            )
            return await self._materialise(
                result, response_format=response_format, operation="edit"
            )
        except Exception as exc:
            raise _map_provider_error(exc) from exc

    async def _materialise(
        self, result: Any, *, response_format: str, operation: str
    ) -> GeneratedImage:
        """把上游响应统一成图片字节：优先 `b64_json`，退化为下载 `url`。"""
        encoded = _first_image_field(result, "b64_json")
        if encoded:
            return GeneratedImage(
                content_type=_content_type(response_format),
                data=base64.b64decode(encoded),
            )
        url = _first_image_field(result, "url")
        if url:
            data = await self._download(url)
            # 上游不按 `response_format` 出图时实际格式可能与请求不一致，
            # 以字节签名为准，无法识别时退回请求声明的格式。
            return GeneratedImage(
                content_type=_content_type_from_bytes(data) or _content_type(response_format),
                data=data,
            )
        description = "edited image" if operation == "edit" else "image"
        raise ProviderPermanentError(f"image provider returned no {description} data")

    async def _download(self, url: str) -> bytes:
        """取回上游返回的图片 URL（签名链接通常只在一段时间内有效）。"""
        try:
            async with httpx.AsyncClient(
                timeout=self.profile.timeout_seconds, follow_redirects=True
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
        except Exception as exc:
            raise _map_provider_error(exc) from exc
        content = response.content
        if not content:
            raise ProviderPermanentError("image provider returned an empty image payload")
        if len(content) > _MAX_IMAGE_DOWNLOAD_BYTES:
            raise ProviderPermanentError("image provider image exceeds the download limit")
        return content


def create_image_provider(profile: ImageProfile, api_key: str | None = None) -> ImageProvider:
    if profile.provider == "mock":
        return MockImageProvider(profile)
    if api_key is None:
        raise ValueError("api_key is required for non-mock image providers")
    return OpenAICompatibleImageProvider(profile, api_key)


def _content_type(response_format: str) -> str:
    return _CONTENT_TYPES.get(response_format, "image/png")


def _content_type_from_bytes(data: bytes) -> str | None:
    """按字节签名判定图片 MIME 类型，无法识别时返回 None。"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _first_image_field(result: Any, field: str) -> str | None:
    data = getattr(result, "data", None)
    if not data:
        return None
    first = data[0]
    value = getattr(first, field, None)
    if isinstance(value, str) and value:
        return value
    if isinstance(first, dict):
        candidate = first.get(field)
        return candidate if isinstance(candidate, str) and candidate else None
    return None


def _map_provider_error(exc: Exception) -> Exception:
    """把上游响应与图片下载的异常映射成路由层可判定的瞬时/永久失败。"""
    if isinstance(exc, (ProviderTransientError, ProviderPermanentError)):
        return exc
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError)):
        return ProviderTransientError(type(exc).__name__)
    if isinstance(exc, APIStatusError):
        if exc.status_code >= 500:
            return ProviderTransientError(f"provider status {exc.status_code}")
        return ProviderPermanentError(
            f"provider status {exc.status_code}", status_code=exc.status_code
        )
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code >= 500:
            return ProviderTransientError(f"image download status {status_code}")
        return ProviderPermanentError(
            f"image download status {status_code}", status_code=status_code
        )
    if isinstance(exc, (httpx.TransportError, TimeoutError, ConnectionError)):
        return ProviderTransientError(type(exc).__name__)
    return ProviderPermanentError(type(exc).__name__)
