from __future__ import annotations

import hashlib
import math
import re

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


def _tokenize(text: str) -> list[str]:
    return _TOKEN_PATTERN.findall(text.lower())
