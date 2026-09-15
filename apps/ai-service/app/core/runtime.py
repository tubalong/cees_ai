from __future__ import annotations

from dataclasses import dataclass

from app.core.config import ModelCatalog, Settings, get_settings, load_catalog_safely
from app.embeddings.router import EmbeddingRouter, build_embedding_router
from app.images.router import ImageRouter
from app.knowledge.pgvector_store import PGVectorStoreGateway
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
    # Embedding 与向量库按配置构建：默认走确定性 provider 与内存库（开发/
    # 测试）；KNOWLEDGE_VECTOR_STORE=pgvector 时连接独立 cees_ai_vectors
    # 库，向量表维度与真实 provider 一致。
    embedding_router = build_embedding_router(catalog)
    knowledge_store = _build_knowledge_store(resolved_settings)
    return AppRuntime(
        resolved_settings,
        catalog,
        router,
        errors,
        image_router,
        embedding_router,
        knowledge_store,
    )


def _build_knowledge_store(settings: Settings) -> VectorStoreGateway:
    if settings.knowledge_vector_store != "pgvector":
        return InMemoryVectorStore()
    if not settings.knowledge_vector_database_url:
        raise ValueError(
            "KNOWLEDGE_VECTOR_DATABASE_URL is required when "
            "knowledge_vector_store is pgvector"
        )
    if not settings.knowledge_vector_dimension:
        raise ValueError(
            "KNOWLEDGE_VECTOR_DIMENSION is required when "
            "knowledge_vector_store is pgvector"
        )
    return PGVectorStoreGateway(
        settings.knowledge_vector_database_url,
        embed_dim=settings.knowledge_vector_dimension,
    )
