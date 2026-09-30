from __future__ import annotations

import base64
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from openai import APIStatusError

from app.core.config import ImageProfile
from app.core.errors import ProviderPermanentError, ProviderTransientError
from app.images import providers
from app.images.providers import OpenAICompatibleImageProvider

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8


class FakeImagesClient:
    """同时覆盖 generate 与 edit 的假客户端。"""

    def __init__(
        self,
        *,
        generate_result: Any = None,
        generate_error: Exception | None = None,
        edit_result: Any = None,
        edit_error: Exception | None = None,
    ) -> None:
        self.generate_result = generate_result
        self.generate_error = generate_error
        self.edit_result = edit_result
        self.edit_error = edit_error
        self.generate_calls: list[dict[str, Any]] = []
        self.edit_calls: list[dict[str, Any]] = []

    async def generate(self, **kwargs: Any) -> Any:
        self.generate_calls.append(kwargs)
        if self.generate_error is not None:
            raise self.generate_error
        return self.generate_result

    async def edit(self, **kwargs: Any) -> Any:
        self.edit_calls.append(kwargs)
        if self.edit_error is not None:
            raise self.edit_error
        return self.edit_result


class FakeOpenAIClient:
    def __init__(self, images: FakeImagesClient) -> None:
        self.images = images


def image_provider(images: FakeImagesClient) -> OpenAICompatibleImageProvider:
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
    return provider


def b64_result(payload: bytes) -> SimpleNamespace:
    encoded = base64.b64encode(payload).decode("ascii")
    return SimpleNamespace(data=[SimpleNamespace(b64_json=encoded)])


def url_result(url: str) -> SimpleNamespace:
    return SimpleNamespace(data=[SimpleNamespace(url=url)])


def status_error(status_code: int) -> APIStatusError:
    request = httpx.Request("POST", "https://example.invalid/v1/images/edits")
    response = httpx.Response(status_code, request=request)
    return APIStatusError("upstream error", response=response, body=None)


@pytest.mark.asyncio
async def test_openai_compatible_image_provider_edits_source_image() -> None:
    images = FakeImagesClient(edit_result=b64_result(b"edited-bytes"))
    provider = image_provider(images)

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
    assert images.generate_calls == []


@pytest.mark.asyncio
async def test_generate_decodes_b64_response() -> None:
    images = FakeImagesClient(generate_result=b64_result(b"png-bytes"))
    provider = image_provider(images)

    result = await provider.generate(
        prompt="a cat", size="1024x1024", quality="standard", response_format="jpeg"
    )

    assert result.data == b"png-bytes"
    # b64 响应由上游按 response_format 出图，沿用请求声明的格式。
    assert result.content_type == "image/jpeg"


@pytest.mark.asyncio
async def test_generate_downloads_url_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """上游只返回 URL（如硅基流动）时在服务端取回字节，并按字节签名判定格式。"""
    images = FakeImagesClient(generate_result=url_result("https://cdn.example/a.png"))
    provider = image_provider(images)
    downloaded: list[str] = []

    async def fake_download(self: OpenAICompatibleImageProvider, url: str) -> bytes:
        downloaded.append(url)
        return PNG_BYTES

    monkeypatch.setattr(OpenAICompatibleImageProvider, "_download", fake_download)

    result = await provider.generate(
        prompt="a cat", size="1024x1024", quality="standard", response_format="webp"
    )

    assert downloaded == ["https://cdn.example/a.png"]
    assert result.data == PNG_BYTES
    # 上游实际返回 PNG，不能照抄请求声明的 webp。
    assert result.content_type == "image/png"


@pytest.mark.asyncio
async def test_generate_without_image_payload_fails_permanently() -> None:
    images = FakeImagesClient(generate_result=SimpleNamespace(data=[SimpleNamespace()]))
    provider = image_provider(images)

    with pytest.raises(ProviderPermanentError, match="no image data"):
        await provider.generate(
            prompt="a cat", size="1024x1024", quality="standard", response_format="png"
        )


@pytest.mark.asyncio
async def test_edit_falls_back_to_multimodal_generation() -> None:
    """上游没有 /images/edits（硅基流动返回 404）时改用 generations + image。"""
    images = FakeImagesClient(
        edit_error=status_error(404),
        generate_result=b64_result(b"edited-bytes"),
    )
    provider = image_provider(images)

    result = await provider.edit(
        prompt="改成绿色",
        source_image=PNG_BYTES,
        size="1024x1024",
        quality="standard",
        response_format="png",
        input_fidelity="high",
    )

    assert result.data == b"edited-bytes"
    assert len(images.generate_calls) == 1
    call = images.generate_calls[0]
    assert call["model"] == "image-model"
    assert call["prompt"] == "改成绿色"
    # input_fidelity 是 OpenAI 编辑接口专有参数，回退路径不发送。
    assert "input_fidelity" not in call
    data_url = call["extra_body"]["image"]
    assert data_url.startswith("data:image/png;base64,")
    assert base64.b64decode(data_url.split(",", 1)[1]) == PNG_BYTES


@pytest.mark.asyncio
async def test_edit_returns_permanent_failure_without_fallback() -> None:
    images = FakeImagesClient(edit_error=status_error(400), generate_result=b64_result(b"x"))
    provider = image_provider(images)

    with pytest.raises(ProviderPermanentError):
        await provider.edit(
            prompt="p",
            source_image=PNG_BYTES,
            size="1024x1024",
            quality="standard",
            response_format="png",
            input_fidelity="high",
        )

    assert images.generate_calls == []


@pytest.mark.asyncio
async def test_edit_treats_upstream_5xx_as_transient() -> None:
    images = FakeImagesClient(edit_error=status_error(503))
    provider = image_provider(images)

    with pytest.raises(ProviderTransientError):
        await provider.edit(
            prompt="p",
            source_image=PNG_BYTES,
            size="1024x1024",
            quality="standard",
            response_format="png",
            input_fidelity="high",
        )


class FakeDownloadResponse:
    def __init__(self, content: bytes, status_code: int = 200) -> None:
        self.content = content
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code < 400:
            return
        request = httpx.Request("GET", "https://cdn.example/a.png")
        response = httpx.Response(self.status_code, request=request)
        raise httpx.HTTPStatusError("bad status", request=request, response=response)


class FakeAsyncHttpClient:
    def __init__(self, response: FakeDownloadResponse) -> None:
        self.response = response
        self.urls: list[str] = []

    async def __aenter__(self) -> FakeAsyncHttpClient:
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def get(self, url: str) -> FakeDownloadResponse:
        self.urls.append(url)
        return self.response


def patch_download(
    monkeypatch: pytest.MonkeyPatch, content: bytes, status_code: int = 200
) -> FakeAsyncHttpClient:
    client = FakeAsyncHttpClient(FakeDownloadResponse(content, status_code))
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: client)
    return client


@pytest.mark.asyncio
async def test_download_returns_bytes_and_rejects_oversized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = image_provider(FakeImagesClient())
    client = patch_download(monkeypatch, b"1234567890")

    assert await provider._download("https://cdn.example/a.png") == b"1234567890"
    assert client.urls == ["https://cdn.example/a.png"]

    monkeypatch.setattr(providers, "_MAX_IMAGE_DOWNLOAD_BYTES", 4)
    with pytest.raises(ProviderPermanentError, match="download limit"):
        await provider._download("https://cdn.example/a.png")


@pytest.mark.asyncio
async def test_download_rejects_empty_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = image_provider(FakeImagesClient())
    patch_download(monkeypatch, b"")

    with pytest.raises(ProviderPermanentError, match="empty image payload"):
        await provider._download("https://cdn.example/a.png")


@pytest.mark.asyncio
async def test_download_maps_upstream_status(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = image_provider(FakeImagesClient())

    patch_download(monkeypatch, b"", status_code=403)
    with pytest.raises(ProviderPermanentError, match="image download status 403"):
        await provider._download("https://cdn.example/a.png")

    patch_download(monkeypatch, b"", status_code=503)
    with pytest.raises(ProviderTransientError, match="image download status 503"):
        await provider._download("https://cdn.example/a.png")
