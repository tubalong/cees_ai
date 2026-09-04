from app.api.schemas.common import Citation
from app.api.schemas.requests import KnowledgeQueryRequest
from app.api.schemas.responses import KnowledgeQueryResponse
from app.repositories.vector_store_repository import VectorSearchFilter, VectorStoreRepository

NO_EVIDENCE = "在您当前有权限访问的资料中未找到足够依据"


class RagService:
    def __init__(self, repository: VectorStoreRepository) -> None:
        self.repository = repository

    async def query(self, request: KnowledgeQueryRequest) -> KnowledgeQueryResponse:
        # TODO: Generate embeddings and use LlamaIndex Retriever with these mandatory metadata filters.
        results = await self.repository.search(
            embedding=[0.0] * 8,
            filters=VectorSearchFilter(
                tenant_id=request.tenant_id,
                allowed_knowledge_base_ids=request.allowed_knowledge_base_ids,
                allowed_document_ids=request.allowed_document_ids,
                permission_filters=request.permission_filters,
            ),
        )
        authorized = [result for result in results if result.score >= 0.65]
        if not authorized:
            return KnowledgeQueryResponse(
                answer=NO_EVIDENCE, citations=[], confidence=0.0, no_answer_reason=NO_EVIDENCE
            )
        citations = [
            Citation(
                document_name=item.document_name or "未命名文档",
                document_id=item.document_id,
                location=item.location or "片段",
                quote=item.content[:300],
            )
            for item in authorized
        ]
        # TODO: Feed only authorized source nodes into LlamaIndex response synthesis.
        return KnowledgeQueryResponse(
            answer=authorized[0].content, citations=citations, confidence=authorized[0].score
        )