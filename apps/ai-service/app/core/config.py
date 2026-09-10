from __future__ import annotations

import os
import tomllib
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SERVICE_ROOT.parents[1] if SERVICE_ROOT.parent.name == "apps" else SERVICE_ROOT


class ModelRole(StrEnum):
    default = "default"
    structured = "structured"
    reasoning = "reasoning"
    rag = "rag"
    orchestrator = "orchestrator"


class OutputMode(StrEnum):
    text = "text"
    json_schema = "json_schema"


class ChatMode(StrEnum):
    standard = "standard"
    ultra = "ultra"


class ModelCapability(StrEnum):
    chat = "chat"
    tool_calling = "tool_calling"
    image_generation = "image_generation"


class ImageProviderKind(StrEnum):
    mock = "mock"
    openai_compatible = "openai_compatible"


class ModelProfile(BaseModel):
    provider: Literal["mock", "openai_compatible", "deepseek"]
    model: str = Field(min_length=1)
    base_url: str | None = None
    api_key_env: str | None = None
    enabled: bool = True
    modes: set[OutputMode] = Field(min_length=1)
    capabilities: set[ModelCapability] = Field(default_factory=lambda: {ModelCapability.chat})
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    default_max_output_tokens: int = Field(default=2048, ge=1, le=32768)
    max_output_tokens_limit: int = Field(default=32768, ge=1, le=32768)
    timeout_seconds: float = Field(default=60.0, gt=0.0, le=600.0)
    max_retries: int = Field(default=2, ge=0, le=10)
    structured_output_method: Literal["function_calling", "json_mode", "json_schema"] = (
        "function_calling"
    )

    @model_validator(mode="after")
    def validate_provider_settings(self) -> ModelProfile:
        if self.default_max_output_tokens > self.max_output_tokens_limit:
            raise ValueError("default_max_output_tokens exceeds max_output_tokens_limit")
        if self.provider != "mock" and (not self.base_url or not self.api_key_env):
            raise ValueError("non-mock profiles require base_url and api_key_env")
        return self


class ImageProfile(BaseModel):
    provider: Literal["mock", "openai_compatible"]
    model: str = Field(min_length=1)
    base_url: str | None = None
    api_key_env: str | None = None
    enabled: bool = True
    timeout_seconds: float = Field(default=60.0, gt=0.0, le=600.0)
    max_retries: int = Field(default=2, ge=0, le=10)

    @model_validator(mode="after")
    def validate_provider_settings(self) -> ImageProfile:
        if self.provider != "mock" and (not self.base_url or not self.api_key_env):
            raise ValueError("non-mock image profiles require base_url and api_key_env")
        return self


class ChatModePolicy(BaseModel):
    role: ModelRole
    reasoning_effort: Literal["low", "high", "max"] | None = None
    default_max_output_tokens: int = Field(default=2048, ge=1, le=32768)
    max_output_tokens_limit: int = Field(default=8192, ge=1, le=32768)
    context_budget_tokens: int = Field(default=32768, ge=1024, le=2_000_000)
    emit_reasoning_status: bool = True

    @model_validator(mode="after")
    def validate_token_settings(self) -> ChatModePolicy:
        if self.default_max_output_tokens > self.max_output_tokens_limit:
            raise ValueError("default_max_output_tokens exceeds max_output_tokens_limit")
        return self


class ChatConfig(BaseModel):
    modes: dict[ChatMode, ChatModePolicy] = Field(min_length=1)
    compaction_role: ModelRole = ModelRole.default
    compaction_max_output_tokens: int = Field(default=2048, ge=256, le=8192)
    compaction_context_budget_tokens: int = Field(default=65536, ge=1024, le=2_000_000)


class ModelCatalog(BaseModel):
    profiles: dict[str, ModelProfile] = Field(min_length=1)
    roles: dict[ModelRole, list[str]] = Field(default_factory=dict)
    chat: ChatConfig | None = None
    image_profiles: dict[str, ImageProfile] = Field(default_factory=dict)

    @field_validator("profiles")
    @classmethod
    def validate_profile_names(cls, value: dict[str, ModelProfile]) -> dict[str, ModelProfile]:
        for name in value:
            if not name or len(name) > 128:
                raise ValueError("profile names must contain 1-128 characters")
        return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", extra="ignore", case_sensitive=False
    )

    node_env: Literal["development", "test", "production"] = "development"
    ai_internal_token: str | None = None
    ai_docs_enabled: bool | None = None
    ai_model_config_path: Path = SERVICE_ROOT / "config/models.toml"
    log_level: str = "INFO"

    @field_validator("ai_model_config_path", mode="after")
    @classmethod
    def resolve_model_config_path(cls, value: Path) -> Path:
        return value if value.is_absolute() else SERVICE_ROOT / value


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_model_catalog(path: Path) -> ModelCatalog:
    with path.open("rb") as file:
        return ModelCatalog.model_validate(tomllib.load(file))


def validate_readiness(settings: Settings, catalog: ModelCatalog) -> list[str]:
    errors: list[str] = []
    token = settings.ai_internal_token
    if not token:
        errors.append("AI_INTERNAL_TOKEN is required")
    elif settings.node_env == "production" and token == "change_me":
        errors.append("AI_INTERNAL_TOKEN must not use the example value in production")

    for role, candidates in catalog.roles.items():
        if not candidates:
            errors.append(f"role {role.value} must contain at least one profile")
            continue
        for profile_name in candidates:
            profile = catalog.profiles.get(profile_name)
            if profile is None:
                errors.append(f"role {role.value} references unknown profile {profile_name}")
                continue
            if not profile.enabled:
                errors.append(f"role {role.value} references disabled profile {profile_name}")
                continue
            required_mode = (
                OutputMode.json_schema if role == ModelRole.structured else OutputMode.text
            )
            if required_mode not in profile.modes:
                errors.append(
                    f"role {role.value} profile {profile_name} does not support "
                    f"{required_mode.value}"
                )
            if settings.node_env == "production" and profile.provider == "mock":
                errors.append(f"role {role.value} uses mock profile {profile_name} in production")

    _validate_chat_readiness(catalog, errors)
    _validate_tool_calling_readiness(catalog, errors)
    _validate_image_readiness(settings, catalog, errors)

    for name, profile in catalog.profiles.items():
        if not profile.enabled or profile.provider == "mock":
            continue
        assert profile.api_key_env is not None
        key = os.getenv(profile.api_key_env)
        if not key:
            errors.append(
                f"enabled profile {name} is missing environment variable {profile.api_key_env}"
            )
        elif settings.node_env == "production" and key == "change_me":
            errors.append(f"enabled profile {name} uses an example API key in production")
        if settings.node_env == "production" and profile.model == "change_me":
            errors.append(f"enabled profile {name} uses an example model in production")
        if (
            settings.node_env == "production"
            and profile.base_url
            and "change_me" in profile.base_url
        ):
            errors.append(f"enabled profile {name} uses an example base URL in production")

    return errors


def _validate_image_readiness(
    settings: Settings, catalog: ModelCatalog, errors: list[str]
) -> None:
    enabled_profiles = [
        (name, profile)
        for name, profile in catalog.image_profiles.items()
        if profile.enabled
    ]
    if not enabled_profiles:
        errors.append("image generation requires at least one enabled image profile")
        return

    for name, profile in enabled_profiles:
        if settings.node_env == "production" and profile.provider == "mock":
            errors.append(f"image profile {name} uses mock provider in production")
            continue
        if profile.provider == "mock":
            continue
        assert profile.api_key_env is not None
        key = os.getenv(profile.api_key_env)
        if not key:
            errors.append(
                f"enabled image profile {name} is missing environment variable "
                f"{profile.api_key_env}"
            )
        elif settings.node_env == "production" and key == "change_me":
            errors.append(f"enabled image profile {name} uses an example API key in production")
        if settings.node_env == "production" and profile.model == "change_me":
            errors.append(f"enabled image profile {name} uses an example model in production")
        if (
            settings.node_env == "production"
            and profile.base_url
            and "change_me" in profile.base_url
        ):
            errors.append(f"enabled image profile {name} uses an example base URL in production")


def _validate_tool_calling_readiness(catalog: ModelCatalog, errors: list[str]) -> None:
    candidates = catalog.roles.get(ModelRole.orchestrator, [])
    if not candidates:
        errors.append("role orchestrator must contain at least one profile")
        return
    for profile_name in candidates:
        profile = catalog.profiles.get(profile_name)
        if profile is None:
            errors.append(f"role orchestrator references unknown profile {profile_name}")
            continue
        if not profile.enabled:
            errors.append(f"role orchestrator references disabled profile {profile_name}")
            continue
        if ModelCapability.tool_calling not in profile.capabilities:
            errors.append(
                f"role orchestrator profile {profile_name} does not support tool_calling"
            )


def _validate_chat_readiness(catalog: ModelCatalog, errors: list[str]) -> None:
    if catalog.chat is None:
        errors.append("chat configuration is required")
        return

    for required_mode in ChatMode:
        if required_mode not in catalog.chat.modes:
            errors.append(f"chat mode {required_mode.value} must be configured")

    checked_roles = {policy.role for policy in catalog.chat.modes.values()} | {
        catalog.chat.compaction_role
    }
    for role in checked_roles:
        candidates = catalog.roles.get(role, [])
        if not candidates:
            errors.append(f"chat references unconfigured role {role.value}")
            continue
        for profile_name in candidates:
            profile = catalog.profiles.get(profile_name)
            if profile is None or not profile.enabled:
                continue
            if OutputMode.text not in profile.modes:
                errors.append(
                    f"chat role {role.value} profile {profile_name} does not support text"
                )

    for mode, policy in catalog.chat.modes.items():
        for profile_name in catalog.roles.get(policy.role, []):
            profile = catalog.profiles.get(profile_name)
            if profile is None or not profile.enabled:
                continue
            if policy.default_max_output_tokens > profile.max_output_tokens_limit:
                errors.append(
                    f"chat mode {mode.value} default_max_output_tokens exceeds "
                    f"profile {profile_name} limit"
                )
            if policy.max_output_tokens_limit > profile.max_output_tokens_limit:
                errors.append(
                    f"chat mode {mode.value} max_output_tokens_limit exceeds "
                    f"profile {profile_name} limit"
                )

    for profile_name in catalog.roles.get(catalog.chat.compaction_role, []):
        profile = catalog.profiles.get(profile_name)
        if profile is None or not profile.enabled:
            continue
        if catalog.chat.compaction_max_output_tokens > profile.max_output_tokens_limit:
            errors.append(f"chat compaction_max_output_tokens exceeds profile {profile_name} limit")


def load_catalog_safely(settings: Settings) -> tuple[ModelCatalog | None, list[str]]:
    try:
        catalog = load_model_catalog(settings.ai_model_config_path)
    except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
        return None, [f"model catalog could not be loaded: {type(exc).__name__}"]
    return catalog, validate_readiness(settings, catalog)
