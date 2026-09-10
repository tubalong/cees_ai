from __future__ import annotations

import base64
from typing import Any

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI, RateLimitError

from app.core.config import ImageProfile
from app.core.errors import ProviderPermanentError, ProviderTransientError
from app.images.types import GeneratedImage, ImageProvider

_CONTENT_TYPES = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


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
            encoded = _first_image_base64(result)
            if not encoded:
                raise ProviderPermanentError("image provider returned no image data")
            return GeneratedImage(
                content_type=_content_type(response_format),
                data=base64.b64decode(encoded),
            )
        except (APIConnectionError, APITimeoutError, RateLimitError) as exc:
            raise ProviderTransientError(type(exc).__name__) from exc
        except APIStatusError as exc:
            if exc.status_code >= 500:
                raise ProviderTransientError(f"provider status {exc.status_code}") from exc
            raise ProviderPermanentError(f"provider status {exc.status_code}") from exc
        except ProviderPermanentError:
            raise
        except Exception as exc:
            raise ProviderPermanentError(type(exc).__name__) from exc


def create_image_provider(profile: ImageProfile, api_key: str | None = None) -> ImageProvider:
    if profile.provider == "mock":
        return MockImageProvider(profile)
    if api_key is None:
        raise ValueError("api_key is required for non-mock image providers")
    return OpenAICompatibleImageProvider(profile, api_key)


def _content_type(response_format: str) -> str:
    return _CONTENT_TYPES.get(response_format, "image/png")


def _first_image_base64(result: Any) -> str | None:
    data = getattr(result, "data", None)
    if not data:
        return None
    first = data[0]
    encoded = getattr(first, "b64_json", None)
    if isinstance(encoded, str) and encoded:
        return encoded
    if isinstance(first, dict):
        value = first.get("b64_json")
        return value if isinstance(value, str) and value else None
    return None
