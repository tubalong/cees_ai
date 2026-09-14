from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import (
    SERVICE_ROOT,
    ChatMode,
    ExtractionConfig,
    ModelProfile,
    ModelRole,
    Settings,
    load_model_catalog,
    validate_readiness,
)

MODEL_FIXTURE = Path("tests/fixtures/models.test.toml")


def test_loads_toml_catalog() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    assert catalog.roles["default"] == ["mock"]
    assert catalog.profiles["mock"].provider == "mock"


def test_production_rejects_mock_role() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    errors = validate_readiness(
        Settings(node_env="production", ai_internal_token="strong-token"), catalog
    )
    assert any("uses mock profile" in error for error in errors)


def test_missing_internal_token_is_not_ready() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    errors = validate_readiness(Settings(node_env="test", ai_internal_token=None), catalog)
    assert "AI_INTERNAL_TOKEN is required" in errors


def test_enabled_openai_profile_requires_key(monkeypatch) -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    catalog.profiles["primary"].enabled = True
    catalog.roles["default"] = ["primary"]
    monkeypatch.delenv("PRIMARY_LLM_API_KEY", raising=False)
    errors = validate_readiness(Settings(node_env="test", ai_internal_token="secret"), catalog)
    assert any("PRIMARY_LLM_API_KEY" in error for error in errors)


def test_role_rejects_profile_without_required_output_mode() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    catalog.roles[ModelRole.structured] = ["mock"]
    errors = validate_readiness(Settings(node_env="test", ai_internal_token="secret"), catalog)
    assert any("does not support json_schema" in error for error in errors)


def test_relative_model_config_path_is_service_relative() -> None:
    settings = Settings(ai_model_config_path=Path("config/models.toml"))
    assert settings.ai_model_config_path == SERVICE_ROOT / "config/models.toml"


def test_deepseek_profile_uses_openai_compatible_adapter_settings() -> None:
    profile = ModelProfile.model_validate(
        {
            "provider": "deepseek",
            "model": "test-model",
            "base_url": "https://example.invalid",
            "api_key_env": "PRIMARY_LLM_API_KEY",
            "modes": ["text"],
        }
    )
    assert profile.provider == "deepseek"


def test_production_rejects_example_model_settings(monkeypatch) -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    catalog.profiles["primary"].enabled = True
    catalog.profiles["primary"].model = "change_me"
    catalog.profiles["primary"].base_url = "https://change_me/v1"
    catalog.roles[ModelRole.default] = ["primary"]
    monkeypatch.setenv("PRIMARY_LLM_API_KEY", "real-test-key")
    errors = validate_readiness(
        Settings(node_env="production", ai_internal_token="strong-token"), catalog
    )
    assert any("example model" in error for error in errors)
    assert any("example base URL" in error for error in errors)


def test_chat_modes_are_loaded_from_catalog() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    assert catalog.chat is not None
    assert catalog.chat.modes[ChatMode.standard].role == ModelRole.default
    assert catalog.chat.modes[ChatMode.ultra].reasoning_effort == "high"


def test_readiness_requires_both_chat_modes() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    assert catalog.chat is not None
    del catalog.chat.modes[ChatMode.ultra]

    errors = validate_readiness(Settings(node_env="test", ai_internal_token="secret"), catalog)

    assert "chat mode ultra must be configured" in errors


def test_chat_mode_limit_cannot_exceed_profile_limit() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    assert catalog.chat is not None
    catalog.chat.modes[ChatMode.ultra].max_output_tokens_limit = 4097

    errors = validate_readiness(Settings(node_env="test", ai_internal_token="secret"), catalog)

    assert any("chat mode ultra max_output_tokens_limit" in error for error in errors)


@pytest.mark.parametrize(
    "path",
    [
        Path("config/models.toml"),
        Path("config/models.staging.example.toml"),
        Path("config/models.production.example.toml"),
    ],
)
def test_deployment_model_catalogs_include_chat_modes(path: Path) -> None:
    catalog = load_model_catalog(path)
    assert catalog.chat is not None
    assert set(catalog.chat.modes) == {ChatMode.standard, ChatMode.ultra}


def test_image_profiles_are_loaded_from_catalog() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    assert catalog.image_profiles["mock"].provider == "mock"
    assert catalog.image_profiles["mock"].model == "mock-image-v1"


def test_readiness_requires_enabled_image_profile() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    catalog.image_profiles.clear()

    errors = validate_readiness(Settings(node_env="test", ai_internal_token="secret"), catalog)

    assert any("image generation requires" in error for error in errors)

def test_extraction_config_defaults() -> None:
    config = ExtractionConfig()
    assert config.max_bytes == 10 * 1024 * 1024
    assert config.max_part_text_chars == 200_000


def test_extraction_config_loads_from_catalog() -> None:
    catalog = load_model_catalog(MODEL_FIXTURE)
    assert catalog.extraction is not None
    assert catalog.extraction.max_bytes == 1234
    assert catalog.extraction.max_part_text_chars == 100
