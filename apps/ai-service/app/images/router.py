from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable

from app.core.config import ImageProfile, ModelCatalog
from app.core.errors import AIServiceError, ProviderPermanentError, ProviderTransientError
from app.images.providers import create_image_provider
from app.images.types import ImageProvider, ImageRoutingResult

logger = logging.getLogger(__name__)
ImageProviderBuilder = Callable[[str, ImageProfile], ImageProvider]


class ImageRouter:
    def __init__(
        self,
        catalog: ModelCatalog,
        provider_builder: ImageProviderBuilder | None = None,
    ) -> None:
        self.catalog = catalog
        self._providers: dict[str, ImageProvider] = {}
        self._provider_builder = provider_builder or self._build_provider

    async def generate(
        self,
        *,
        request_id: str,
        prompt: str,
        size: str,
        quality: str,
        response_format: str,
    ) -> ImageRoutingResult:
        candidates = [
            name
            for name, profile in self.catalog.image_profiles.items()
            if profile.enabled
        ]
        if not candidates:
            raise AIServiceError(
                "AI_SERVICE_NOT_READY",
                "No enabled image generation profiles are configured",
                status_code=503,
                retryable=True,
                request_id=request_id,
            )

        started = time.perf_counter()
        last_transient_error: ProviderTransientError | None = None
        for index, profile_name in enumerate(candidates):
            profile = self.catalog.image_profiles[profile_name]
            provider = self._get_provider(profile_name, profile)
            try:
                image = await provider.generate(
                    prompt=prompt,
                    size=size,
                    quality=quality,
                    response_format=response_format,
                )
                latency_ms = round((time.perf_counter() - started) * 1000)
                logger.info(
                    "image generation completed",
                    extra={
                        "request_id": request_id,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "fallback_count": index,
                        "latency_ms": latency_ms,
                    },
                )
                return ImageRoutingResult(
                    profile_name=profile_name,
                    profile=profile,
                    content_type=image.content_type,
                    data=image.data,
                    fallback_count=index,
                    latency_ms=latency_ms,
                )
            except ProviderTransientError as exc:
                last_transient_error = exc
                logger.warning(
                    "image provider transient failure",
                    extra={
                        "request_id": request_id,
                        "profile": profile_name,
                        "provider": profile.provider,
                        "model": profile.model,
                        "attempt": index + 1,
                        "error_category": type(exc).__name__,
                    },
                )
            except ProviderPermanentError as exc:
                raise AIServiceError(
                    "IMAGE_GENERATION_UNAVAILABLE",
                    "The selected image provider rejected the request",
                    status_code=503,
                    request_id=request_id,
                ) from exc

        raise AIServiceError(
            "IMAGE_GENERATION_UNAVAILABLE",
            "No configured image profile completed the generation",
            status_code=503,
            retryable=True,
            request_id=request_id,
        ) from last_transient_error

    def _get_provider(self, profile_name: str, profile: ImageProfile) -> ImageProvider:
        provider = self._providers.get(profile_name)
        if provider is None:
            provider = self._provider_builder(profile_name, profile)
            self._providers[profile_name] = provider
        return provider

    @staticmethod
    def _build_provider(profile_name: str, profile: ImageProfile) -> ImageProvider:
        api_key = os.getenv(profile.api_key_env) if profile.api_key_env else None
        try:
            return create_image_provider(profile, api_key)
        except ValueError as exc:
            raise AIServiceError(
                "AI_SERVICE_NOT_READY",
                f"Image profile {profile_name} is not configured",
                status_code=503,
                retryable=True,
            ) from exc
