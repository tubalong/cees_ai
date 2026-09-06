from __future__ import annotations

from pathlib import Path

from app.core.config import ModelRole, Settings, load_model_catalog, validate_readiness


def test_loads_toml_catalog() -> None:
    catalog = load_model_catalog(Path("config/models.toml"))
    assert catalog.roles["default"] == ["mock"]
    assert catalog.profiles["mock"].provider == "mock"


def test_production_rejects_mock_role() -> None:
    catalog = load_model_catalog(Path("config/models.toml"))
    errors = validate_readiness(
        Settings(node_env="production", ai_internal_token="strong-token"), catalog
    )
    assert any("uses mock profile" in error for error in errors)


def test_missing_internal_token_is_not_ready() -> None:
    catalog = load_model_catalog(Path("config/models.toml"))
    errors = validate_readiness(Settings(node_env="test", ai_internal_token=None), catalog)
    assert "AI_INTERNAL_TOKEN is required" in errors


def test_enabled_openai_profile_requires_key(monkeypatch) -> None:
    catalog = load_model_catalog(Path("config/models.toml"))
    catalog.profiles["primary"].enabled = True
    catalog.roles["default"] = ["primary"]
    monkeypatch.delenv("PRIMARY_LLM_API_KEY", raising=False)
    errors = validate_readiness(
        Settings(node_env="test", ai_internal_token="secret"), catalog
    )
    assert any("PRIMARY_LLM_API_KEY" in error for error in errors)


def test_role_rejects_profile_without_required_output_mode() -> None:
    catalog = load_model_catalog(Path("config/models.toml"))
    catalog.roles[ModelRole.structured] = ["mock"]
    errors = validate_readiness(
        Settings(node_env="test", ai_internal_token="secret"), catalog
    )
    assert any("does not support json_schema" in error for error in errors)
