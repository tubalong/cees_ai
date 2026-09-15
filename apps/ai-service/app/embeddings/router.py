from __future__ import annotations

from dataclasses import dataclass

from app.embeddings.providers import DeterministicEmbeddingProvider
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


def _assert_dimension(
    provider: EmbeddingProvider, vectors: list[list[float]]
) -> None:
    for vector in vectors:
        if len(vector) != provider.dimension:
            raise ValueError(
                f"embedding dimension mismatch: expected {provider.dimension}, got {len(vector)}"
            )
