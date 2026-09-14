from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from app.core.config import ImageProfile, ModelCatalog, ModelRole
from app.core.errors import ProviderTransientError
from app.images.router import ImageRouter
from app.images.types import GeneratedImage
from app.llm.router import LLMRouter
from app.main import create_app
from tests.helpers import profile, ready_runtime


class StubImageProvider:
    def __init__(self, profile: ImageProfile, outcome: GeneratedImage | Exception) -> None:
        self.profile = profile
        self.outcome = outcome
        self.calls = 0

    async def generate(
        self,
        *,
        prompt: str,
        size: str,
        quality: str,
        response_format: str,
    ) -> GeneratedImage:
        del prompt, size, quality, response_format
        self.calls += 1
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome

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
        del source_image, input_fidelity
        return await self.generate(
            prompt=prompt,
            size=size,
            quality=quality,
            response_format=response_format,
        )


def image_catalog() -> ModelCatalog:
    llm_profile = profile()
    return ModelCatalog(
        profiles={"primary": llm_profile},
        roles={ModelRole.default: ["primary"]},
        image_profiles={
            "mock": ImageProfile.model_validate(
                {
                    "provider": "mock",
                    "model": "mock-image-v1",
                    "enabled": True,
                    "timeout_seconds": 30.0,
                    "max_retries": 0,
                }
            )
        },
    )


@pytest.mark.asyncio
async def test_image_generate_falls_back_to_next_profile_on_transient_failure() -> None:
    primary_profile = ImageProfile(provider="mock", model="primary-image")
    backup_profile = ImageProfile(provider="mock", model="backup-image")
    primary = StubImageProvider(primary_profile, ProviderTransientError("timeout"))
    backup = StubImageProvider(
        backup_profile,
        GeneratedImage(content_type="image/png", data=b"backup-image-bytes"),
    )
    providers = {"primary": primary, "backup": backup}
    catalog = ModelCatalog(
        profiles={"primary": profile()},
        roles={ModelRole.default: ["primary"]},
        image_profiles={"primary": primary_profile, "backup": backup_profile},
    )
    router = ImageRouter(catalog, lambda name, _profile: providers[name])

    routed = await router.generate(
        request_id="req-image-fallback-1",
        prompt="A cat",
        size="1024x1024",
        quality="standard",
        response_format="png",
    )

    assert routed.profile_name == "backup"
    assert routed.profile.model == "backup-image"
    assert routed.data == b"backup-image-bytes"
    assert routed.fallback_count == 1
    assert primary.calls == backup.calls == 1


def image_payload() -> dict[str, object]:
    return {
        "request_id": "req-image-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "prompt": "A cat",
        "size": "1024x1024",
        "quality": "standard",
        "response_format": "png",
    }


def test_image_generate_returns_mock_image_and_metadata() -> None:
    model_catalog = image_catalog()
    llm_router = LLMRouter(model_catalog, lambda _name, _profile: object())
    image_router = ImageRouter(model_catalog)
    client = TestClient(
        create_app(runtime=ready_runtime(llm_router, model_catalog, image_router=image_router))
    )

    with client:
        response = client.post(
            "/internal/v1/images/generate",
            headers={"X-AI-Internal-Token": "secret"},
            json=image_payload(),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "req-image-1"
    assert body["content_type"] == "image/png"
    assert base64.b64decode(body["data_base64"]) == b"mock-image-bytes"
    assert body["execution"]["profile"] == "mock"
    assert body["execution"]["provider"] == "mock"
    assert body["execution"]["model"] == "mock-image-v1"
    assert body["execution"]["width"] is None
    assert body["execution"]["height"] is None
    assert body["execution"]["token_usage"] == {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
    }


def test_image_generate_accepts_arbitrary_size() -> None:
    model_catalog = image_catalog()
    llm_router = LLMRouter(model_catalog, lambda _name, _profile: object())
    image_router = ImageRouter(model_catalog)
    client = TestClient(
        create_app(runtime=ready_runtime(llm_router, model_catalog, image_router=image_router))
    )

    payload = image_payload()
    payload["size"] = "256x256"

    with client:
        response = client.post(
            "/internal/v1/images/generate",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )

    assert response.status_code == 200
    assert response.json()["request_id"] == "req-image-1"


def test_image_preview_returns_raw_bytes_with_header_token() -> None:
    model_catalog = image_catalog()
    llm_router = LLMRouter(model_catalog, lambda _name, _profile: object())
    image_router = ImageRouter(model_catalog)
    client = TestClient(
        create_app(runtime=ready_runtime(llm_router, model_catalog, image_router=image_router))
    )

    with client:
        response = client.get(
            "/internal/v1/images/preview",
            params={"prompt": "A cat", "size": "256x256"},
            headers={"X-AI-Internal-Token": "secret"},
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == b"mock-image-bytes"


def test_image_preview_accepts_query_token() -> None:
    model_catalog = image_catalog()
    llm_router = LLMRouter(model_catalog, lambda _name, _profile: object())
    image_router = ImageRouter(model_catalog)
    client = TestClient(
        create_app(runtime=ready_runtime(llm_router, model_catalog, image_router=image_router))
    )

    with client:
        response = client.get(
            "/internal/v1/images/preview",
            params={"prompt": "A cat", "token": "secret"},
        )

    assert response.status_code == 200
    assert response.content == b"mock-image-bytes"

def image_edit_payload() -> dict[str, object]:
    return {
        "request_id": "req-edit-1",
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "prompt": "Make the colors warmer",
        "source_image_base64": base64.b64encode(b"source-image-bytes").decode("ascii"),
        "size": "1024x1024",
        "quality": "standard",
        "response_format": "png",
        "input_fidelity": "high",
    }


def test_image_edit_returns_mock_image_and_metadata() -> None:
    model_catalog = image_catalog()
    llm_router = LLMRouter(model_catalog, lambda _name, _profile: object())
    image_router = ImageRouter(model_catalog)
    client = TestClient(
        create_app(runtime=ready_runtime(llm_router, model_catalog, image_router=image_router))
    )

    with client:
        response = client.post(
            "/internal/v1/images/edit",
            headers={"X-AI-Internal-Token": "secret"},
            json=image_edit_payload(),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "req-edit-1"
    assert body["content_type"] == "image/png"
    assert base64.b64decode(body["data_base64"]) == b"mock-edited-image-bytes"
    assert body["execution"]["profile"] == "mock"
    assert body["execution"]["provider"] == "mock"
    assert body["execution"]["model"] == "mock-image-v1"


def test_image_edit_rejects_invalid_source_base64() -> None:
    model_catalog = image_catalog()
    llm_router = LLMRouter(model_catalog, lambda _name, _profile: object())
    image_router = ImageRouter(model_catalog)
    client = TestClient(
        create_app(runtime=ready_runtime(llm_router, model_catalog, image_router=image_router))
    )

    payload = image_edit_payload()
    payload["source_image_base64"] = "not-valid-base64!!"

    with client:
        response = client.post(
            "/internal/v1/images/edit",
            headers={"X-AI-Internal-Token": "secret"},
            json=payload,
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_IMAGE_EDIT_REQUEST"
