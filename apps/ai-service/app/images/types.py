from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.core.config import ImageProfile


@dataclass(frozen=True)
class GeneratedImage:
    content_type: str
    data: bytes


@dataclass(frozen=True)
class ImageRoutingResult:
    profile_name: str
    profile: ImageProfile
    content_type: str
    data: bytes
    fallback_count: int
    latency_ms: int


class ImageProvider(Protocol):
    profile: ImageProfile

    async def generate(
        self,
        *,
        prompt: str,
        size: str,
        quality: str,
        response_format: str,
    ) -> GeneratedImage: ...
