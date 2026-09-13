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
