from __future__ import annotations

from dataclasses import dataclass

from app.core.config import ModelCatalog
from app.embeddings.providers import (
    DeterministicEmbeddingProvider,
    OpenAICompatibleEmbeddingProvider,
)
from app.embeddings.types import EmbeddingProvider


@dataclass
class EmbeddingRouter:
    """按名称解析 Embedding profile 的路由器。

    与 LLMRouter 分离：答案生成走 LLMRouter（rag role），Embedding 只
    服务于索引与检索。索引与检索必须使用同一 profile，否则向量空间不一致。
    """

    profiles: dict[str, EmbeddingProvider]
    default_profile: str

    def resolve_name(self, profile_name: str | None) -> str:
        """返回实际生效的 profile 名称；未知名称抛 KeyError。"""
        name = profile_name or self.default_profile
        if name not in self.profiles:
            raise KeyError(f"unknown embedding profile: {name}")
        return name

    def resolve(self, profile_name: str | None) -> EmbeddingProvider:
        return self.profiles[self.resolve_name(profile_name)]

    def is_deterministic(self, profile_name: str | None) -> bool:
        """解析后的 profile 是否为内置确定性 provider（开发用哈希向量）。

        未知名称抛 KeyError，与 resolve/resolve_name 语义一致。
        """
        return isinstance(self.resolve(profile_name), DeterministicEmbeddingProvider)

    async def embed_documents(
        self, profile_name: str | None, texts: list[str]
    ) -> list[list[float]]:
        provider = self.resolve(profile_name)
        vectors = await provider.embed_documents(texts)
        _assert_dimension(provider, vectors)
        return vectors

    async def embed_query(self, profile_name: str | None, text: str) -> list[float]:
        provider = self.resolve(profile_name)
        vector = await provider.embed_query(text)
        _assert_dimension(provider, [vector])
        return vector


def build_default_embedding_router() -> EmbeddingRouter:
    """构建仅含确定性 provider 的路由器，用于开发与测试。"""
    deterministic = DeterministicEmbeddingProvider()
    return EmbeddingRouter(
        profiles={"deterministic": deterministic},
        default_profile="deterministic",
    )


def build_embedding_router(catalog: ModelCatalog | None) -> EmbeddingRouter:
    """按模型目录构建路由器：确定性 provider 始终可用，外部 provider 按配置注册。

    默认 profile 取第一个启用的外部 provider，未配置任何外部 provider 时
    回落到 deterministic。外部 provider 构造失败（如 API key 缺失）时跳过，
    相应错误由 readiness 校验上报，不阻塞启动。
    """
    profiles: dict[str, EmbeddingProvider] = {
        "deterministic": DeterministicEmbeddingProvider()
    }
    default_profile = "deterministic"
    if catalog is not None:
        for name, profile in catalog.embedding_profiles.items():
            if not profile.enabled:
                continue
            try:
                profiles[name] = OpenAICompatibleEmbeddingProvider(profile)
            except ValueError:
                continue
            if default_profile == "deterministic":
                default_profile = name
    return EmbeddingRouter(profiles=profiles, default_profile=default_profile)


def _assert_dimension(
    provider: EmbeddingProvider, vectors: list[list[float]]
) -> None:
    for vector in vectors:
        if len(vector) != provider.dimension:
            raise ValueError(
                f"embedding dimension mismatch: expected {provider.dimension}, got {len(vector)}"
            )
