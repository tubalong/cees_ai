from __future__ import annotations

from dataclasses import dataclass

from app.core.config import ModelCatalog, Settings, get_settings, load_catalog_safely
from app.embeddings.router import EmbeddingRouter, build_default_embedding_router
from app.images.router import ImageRouter
from app.knowledge.stores import InMemoryVectorStore, VectorStoreGateway
from app.llm.router import LLMRouter, ProviderBuilder


@dataclass
class AppRuntime:
    settings: Settings
    catalog: ModelCatalog | None
    router: LLMRouter | None
    readiness_errors: list[str]
    image_router: ImageRouter | None = None
    embedding_router: EmbeddingRouter | None = None
    knowledge_store: VectorStoreGateway | None = None

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
    image_router = ImageRouter(catalog) if catalog is not None else None
    # 块 2 使用确定性 Embedding 与内存向量库跑通闭环；块 4 替换为
    # 真实 Embedding provider 与 pgvector Gateway。内存库进程重启即丢失。
    embedding_router = build_default_embedding_router()
    knowledge_store = InMemoryVectorStore()
    return AppRuntime(
        resolved_settings,
        catalog,
        router,
        errors,
        image_router,
        embedding_router,
        knowledge_store,
    )
