from __future__ import annotations

import base64
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import ImageProfile
from app.images.providers import OpenAICompatibleImageProvider


class FakeImageEditClient:
    def __init__(self, encoded: str) -> None:
        self.encoded = encoded
        self.edit_calls: list[dict[str, Any]] = []

    async def edit(self, **kwargs: Any) -> SimpleNamespace:
        self.edit_calls.append(kwargs)
        return SimpleNamespace(data=[SimpleNamespace(b64_json=self.encoded)])


class FakeOpenAIClient:
    def __init__(self, images: FakeImageEditClient) -> None:
        self.images = images


@pytest.mark.asyncio
async def test_openai_compatible_image_provider_edits_source_image() -> None:
    encoded = base64.b64encode(b"edited-bytes").decode("ascii")
    images = FakeImageEditClient(encoded)
    provider = object.__new__(OpenAICompatibleImageProvider)
    provider.profile = ImageProfile.model_validate(
        {
            "provider": "openai_compatible",
            "model": "image-model",
            "base_url": "https://example.invalid/v1",
            "api_key_env": "TEST_KEY",
            "enabled": True,
        }
    )
    provider.client = FakeOpenAIClient(images)

    result = await provider.edit(
        prompt="Make it warmer",
        source_image=b"source-bytes",
        size="1024x1024",
        quality="standard",
        response_format="png",
        input_fidelity="high",
    )

    assert result.data == b"edited-bytes"
    assert result.content_type == "image/png"
    assert images.edit_calls[0]["model"] == "image-model"
    assert images.edit_calls[0]["image"] == b"source-bytes"
    assert images.edit_calls[0]["prompt"] == "Make it warmer"
    assert images.edit_calls[0]["input_fidelity"] == "high"
    assert images.edit_calls[0]["response_format"] == "b64_json"
