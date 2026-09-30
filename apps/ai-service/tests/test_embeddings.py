from __future__ import annotations

import pytest

from app.core.config import EmbeddingProfile, ModelCatalog, ModelProfile
from app.embeddings.providers import OpenAICompatibleEmbeddingProvider
from app.embeddings.router import build_default_embedding_router, build_embedding_router


class _FakeEmbeddings:
    def __init__(self, vectors: list[list[float]]) -> None:
        self.vectors = vectors

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        assert len(texts) == len(self.vectors)
        return self.vectors

    async def aembed_query(self, text: str) -> list[float]:
        return self.vectors[0]


def make_embedding_profile(**overrides: object) -> EmbeddingProfile:
    values: dict[str, object] = {
        "provider": "openai_compatible",
        "model": "text-embedding-3-small",
        "base_url": "https://embed.example/v1",
        "api_key_env": "EMBEDDING_API_KEY",
        "enabled": True,
        "dimension": 1536,
    }
    values.update(overrides)
    return EmbeddingProfile.model_validate(values)


def make_catalog(**overrides: object) -> ModelCatalog:
    values: dict[str, object] = {
        "profiles": {
            "p": ModelProfile(
                provider="mock",
                model="mock-text-v1",
                modes={"text"},
                capabilities={"chat"},
            )
        }
    }
    values.update(overrides)
    return ModelCatalog.model_validate(values)


async def test_openai_compatible_embeds_and_normalizes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EMBEDDING_API_KEY", "test-key")
    provider = OpenAICompatibleEmbeddingProvider(make_embedding_profile())
    provider._client = _FakeEmbeddings([[3.0, 4.0, 0.0, 0.0], [0.0, 0.0, 5.0, 0.0]])
    assert provider.dimension == 1536

    query = await provider.embed_query("query")
    docs = await provider.embed_documents(["a", "b"])

    assert query == [0.6, 0.8, 0.0, 0.0]
    assert docs == [[0.6, 0.8, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]]


def test_openai_compatible_missing_api_key_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EMBEDDING_API_KEY", raising=False)
    with pytest.raises(ValueError, match="EMBEDDING_API_KEY"):
        OpenAICompatibleEmbeddingProvider(make_embedding_profile())


def test_openai_compatible_requests_declared_dimension(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """声明的 dimension 必须作为 OpenAI `dimensions` 参数发给上游。"""
    monkeypatch.setenv("EMBEDDING_API_KEY", "test-key")
    captured: dict[str, object] = {}

    class _RecordingEmbeddings:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

    monkeypatch.setattr("app.embeddings.providers.OpenAIEmbeddings", _RecordingEmbeddings)

    OpenAICompatibleEmbeddingProvider(make_embedding_profile(dimension=1536))

    assert captured["dimensions"] == 1536


def test_build_embedding_router_registers_enabled_profiles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EMBEDDING_API_KEY", "test-key")
    catalog = make_catalog(
        embedding_profiles={"primary": make_embedding_profile()},
    )
    router = build_embedding_router(catalog)

    assert router.default_profile == "primary"
    assert set(router.profiles) == {"deterministic", "primary"}
    assert router.is_deterministic(None) is False
    assert router.is_deterministic("primary") is False
    assert router.is_deterministic("deterministic") is True


def test_build_embedding_router_skips_disabled_profiles() -> None:
    catalog = make_catalog(
        embedding_profiles={
            "primary": make_embedding_profile(enabled=False),
        },
    )
    router = build_embedding_router(catalog)

    assert router.default_profile == "deterministic"
    assert set(router.profiles) == {"deterministic"}


def test_build_embedding_router_skips_missing_key() -> None:
    catalog = make_catalog(
        embedding_profiles={"primary": make_embedding_profile()},
    )
    router = build_embedding_router(catalog)

    assert router.default_profile == "deterministic"
    assert set(router.profiles) == {"deterministic"}


def test_build_embedding_router_without_catalog_returns_deterministic() -> None:
    router = build_embedding_router(None)
    assert router.default_profile == "deterministic"
    assert set(router.profiles) == {"deterministic"}
    assert router.resolve_name(None) == "deterministic"


def test_default_router_resolves_deterministic() -> None:
    router = build_default_embedding_router()
    assert router.resolve_name(None) == "deterministic"
    assert router.resolve_name("deterministic") == "deterministic"
    assert router.is_deterministic(None) is True
    assert router.is_deterministic("deterministic") is True
