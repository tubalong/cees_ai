from __future__ import annotations

from typing import Protocol


class EmbeddingProvider(Protocol):
    """Embedding 提供方协议。

    与 LLMRouter 分离：Embedding 只负责文本到向量，不参与答案生成。
    所有 provider 必须声明固定维度并返回归一化向量，检索端按余弦相似度计算。
    """

    dimension: int

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """把一批文档文本嵌入为等长向量。"""

    async def embed_query(self, text: str) -> list[float]:
        """把单条查询文本嵌入为向量。"""
