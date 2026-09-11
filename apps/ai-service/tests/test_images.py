from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from app.core.config import ImageProfile, ModelCatalog, ModelRole
from app.images.router import ImageRouter
from app.llm.router import LLMRouter
from app.main import create_app
from tests.helpers import profile, ready_runtime


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
    assert body["execution"]["token_usage"] == {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
    }
