from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import asyncpg


@dataclass(frozen=True)
class VectorSearchFilter:
    tenant_id: str
    allowed_knowledge_base_ids: list[str]
    allowed_document_ids: list[str] | None
    permission_filters: dict[str, Any]


@dataclass(frozen=True)
class VectorSearchResult:
    document_id: str
    document_name: str
    location: str
    content: str
    score: float


class VectorStoreRepository(ABC):
    @abstractmethod
    async def upsert_chunks(self, chunks: list[dict[str, Any]]) -> None: ...

    @abstractmethod
    async def search(
        self, embedding: list[float], filters: VectorSearchFilter, limit: int = 8
    ) -> list[VectorSearchResult]: ...

    @abstractmethod
    async def delete_by_document(self, tenant_id: str, document_id: str) -> None: ...

    @abstractmethod
    async def delete_by_knowledge_base(self, tenant_id: str, knowledge_base_id: str) -> None: ...

    @abstractmethod
    async def health_check(self) -> bool: ...


class PgVectorStoreRepository(VectorStoreRepository):
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    async def upsert_chunks(self, chunks: list[dict[str, Any]]) -> None:
        # TODO: Use LlamaIndex PGVectorStore for production ingestion after embedding dimensions are fixed.
        if any(not chunk.get("tenant_id") for chunk in chunks):
            raise ValueError("Every chunk requires tenant_id")

    async def search(
        self, embedding: list[float], filters: VectorSearchFilter, limit: int = 8
    ) -> list[VectorSearchResult]:
        if not filters.tenant_id or not filters.allowed_knowledge_base_ids:
            raise ValueError("tenant_id and allowed knowledge bases are mandatory")
        clauses = ["tenant_id = $1", "knowledge_base_id = ANY($2::uuid[])", "deleted_at IS NULL"]
        parameters: list[Any] = [filters.tenant_id, filters.allowed_knowledge_base_ids]
        if filters.allowed_document_ids is not None:
            clauses.append(f"document_id = ANY(${len(parameters) + 1}::uuid[])")
            parameters.append(filters.allowed_document_ids)
        parameters.extend([str(embedding), limit])
        sql = f"""
            SELECT document_id::text, metadata->>'document_name' AS document_name,
                   metadata->>'location' AS location, content,
                   1 - (embedding <=> ${len(parameters) - 1}::vector) AS score
            FROM document_chunks
            WHERE {' AND '.join(clauses)}
            ORDER BY embedding <=> ${len(parameters) - 1}::vector
            LIMIT ${len(parameters)}
        """
        connection = await asyncpg.connect(self.database_url)
        try:
            rows = await connection.fetch(sql, *parameters)
            return [VectorSearchResult(**dict(row)) for row in rows]
        finally:
            await connection.close()

    async def delete_by_document(self, tenant_id: str, document_id: str) -> None:
        await self._execute_delete("document_id", tenant_id, document_id)

    async def delete_by_knowledge_base(self, tenant_id: str, knowledge_base_id: str) -> None:
        await self._execute_delete("knowledge_base_id", tenant_id, knowledge_base_id)

    async def _execute_delete(self, column: str, tenant_id: str, resource_id: str) -> None:
        connection = await asyncpg.connect(self.database_url)
        try:
            await connection.execute(
                f"DELETE FROM document_chunks WHERE tenant_id = $1 AND {column} = $2",
                tenant_id,
                resource_id,
            )
        finally:
            await connection.close()

    async def health_check(self) -> bool:
        connection = await asyncpg.connect(self.database_url)
        try:
            return bool(await connection.fetchval("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector')"))
        finally:
            await connection.close()


# Future repositories are intentionally not implemented or installed:
# QdrantVectorStoreRepository, MilvusVectorStoreRepository.