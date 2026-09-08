from __future__ import annotations

from dataclasses import dataclass

from app.core.config import ModelCatalog, Settings, get_settings, load_catalog_safely
from app.llm.router import LLMRouter, ProviderBuilder


@dataclass
class AppRuntime:
    settings: Settings
    catalog: ModelCatalog | None
    router: LLMRouter | None
    readiness_errors: list[str]

    @property
    def ready(self) -> bool:
        return self.catalog is not None and self.router is not None and not self.readiness_errors

    @property
    def configured_roles(self) -> list[str]:
        return sorted(role.value for role in self.catalog.roles) if self.catalog else []

    @property
    def configured_chat_modes(self) -> list[str]:
        if self.catalog is None or self.catalog.chat is None:
            return []
        return sorted(mode.value for mode in self.catalog.chat.modes)


def build_runtime(
    settings: Settings | None = None,
    provider_builder: ProviderBuilder | None = None,
) -> AppRuntime:
    resolved_settings = settings or get_settings()
    catalog, errors = load_catalog_safely(resolved_settings)
    router = LLMRouter(catalog, provider_builder) if catalog is not None else None
    return AppRuntime(resolved_settings, catalog, router, errors)
