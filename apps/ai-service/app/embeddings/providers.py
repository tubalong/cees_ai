from __future__ import annotations

import hashlib
import math
import os
import re

from langchain_openai import OpenAIEmbeddings

from app.core.config import EmbeddingProfile

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+|[\u4e00-\u9fff]")


class DeterministicEmbeddingProvider:
    """基于特征哈希的确定性 Embedding，仅用于开发与测试。

    同一文本永远产生同一向量，不依赖外部服务，因此适合在没有真实
    Embedding 服务的环境下验证切分、幂等、过滤和检索链路。哈希向量的
    语义相似度有限，生产环境必须使用真实 Embedding provider。

    dimension 固定为 384。
    """

    dimension = 384

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    async def embed_query(self, text: str) -> list[float]:
        return self._embed(text)

    def _embed(self, text: str) -> list[float]:
        vector = [0.0] * self.dimension
        for token in _tokenize(text):
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            bucket = int.from_bytes(digest, "big") % self.dimension
            sign = 1.0 if digest[0] & 1 else -1.0
            vector[bucket] += sign
        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]


class OpenAICompatibleEmbeddingProvider:
    """OpenAI 兼容 Embedding provider，服务知识库索引与检索。

    返回向量统一做 L2 归一化，保证检索端余弦相似度取值与确定性
    provider 一致；dimension 来自配置声明，与模型真实维度不符时由
    EmbeddingRouter 的维度校验拦截。
    """

    def __init__(self, profile: EmbeddingProfile) -> None:
        assert profile.api_key_env is not None
        api_key = os.getenv(profile.api_key_env)
        if not api_key:
            raise ValueError(
                f"embedding profile {profile.model} is missing environment "
                f"variable {profile.api_key_env}"
            )
        self.dimension = profile.dimension
        self._client = OpenAIEmbeddings(
            model=profile.model,
            api_key=api_key,
            base_url=profile.base_url,
            timeout=profile.timeout_seconds,
            max_retries=profile.max_retries,
            # 关闭 langchain 的上下文长度检查：开启时会把文本转成 token ID
            # 再发给 /embeddings，OpenAI 兼容的自建服务（如 BGE）只接受
            # 原始字符串输入，会以 422 拒绝。
            check_embedding_ctx_length=False,
        )

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors = await self._client.aembed_documents(texts)
        return [_normalize(vector) for vector in vectors]

    async def embed_query(self, text: str) -> list[float]:
        vector = await self._client.aembed_query(text)
        return _normalize(vector)


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _tokenize(text: str) -> list[str]:
    return _TOKEN_PATTERN.findall(text.lower())
