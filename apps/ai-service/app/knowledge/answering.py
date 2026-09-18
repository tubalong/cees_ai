from __future__ import annotations

from app.api.generated.models import (
    ExecutionMetadata,
    KnowledgeAnswerCitation,
    KnowledgeAnswerRequest,
    KnowledgeAnswerResponse,
    KnowledgeRetrieveRequest,
    Provider,
    RetrievedChunk,
    TokenUsage,
)
from app.core.config import ModelRole, OutputMode
from app.core.errors import AIServiceError
from app.embeddings.router import EmbeddingRouter
from app.knowledge.retrieval import retrieve_chunks
from app.knowledge.stores import VectorStoreGateway
from app.llm.router import LLMRouter
from app.llm.types import ChatMessage

# 模型只输出引用编号（S1..Sn），不允许编造文档 ID、页码或 URL；
# 编号按检索顺序分配，服务端负责映射回真实 chunk 来源。
_ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "citation_ids": {
            "type": "array",
            "items": {"type": "string", "pattern": "^S[1-9][0-9]*$"},
        },
        "insufficient_evidence": {"type": "boolean"},
    },
    "required": ["answer", "citation_ids", "insufficient_evidence"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = (
    "你是企业知识库问答助手。只能依据提供的证据片段回答问题，"
    "回答中用 [S编号] 标注引用来源。如果证据不足以回答问题，"
    "把 insufficient_evidence 置为 true，不要编造证据之外的内容。"
)


async def answer_question(
    request: KnowledgeAnswerRequest,
    *,
    store: VectorStoreGateway,
    embedding_router: EmbeddingRouter,
    llm_router: LLMRouter,
) -> KnowledgeAnswerResponse:
    """检索可信 scope 内的 chunk 并生成带引用的 grounded 答案。

    流程：内部先 retrieve -> 空结果短路（不调用 LLM）-> rag role
    json_schema 生成 -> citation_ids 校验并映射回真实来源。模型只能
    引用服务端分配的编号，无法编造文档 ID、页码或 URL。
    """
    retrieved = await retrieve_chunks(
        KnowledgeRetrieveRequest(
            request_id=request.request_id,
            tenant_id=request.tenant_id,
            user_id=request.user_id,
            query=request.query,
            scope=request.scope,
            top_k=request.top_k,
            index_version=request.index_version,
            embedding_profile=request.embedding_profile,
        ),
        store=store,
        embedding_router=embedding_router,
    )

    # 空结果短路：证据不足时不调用 LLM，避免模型凭想象回答。
    if not retrieved.chunks:
        return KnowledgeAnswerResponse(
            request_id=request.request_id,
            answer="",
            grounded=False,
            insufficient_evidence=True,
            citations=[],
            execution=None,
            index_version=retrieved.index_version,
            embedding_profile=retrieved.embedding_profile,
        )

    labels = [f"S{index + 1}" for index in range(len(retrieved.chunks))]
    evidence = "\n\n".join(
        f"[{label}] {chunk.text}"
        for label, chunk in zip(labels, retrieved.chunks, strict=True)
    )
    result = await llm_router.invoke(
        request_id=request.request_id,
        tenant_id=request.tenant_id,
        user_id=request.user_id,
        messages=[
            ChatMessage(role="system", content=_SYSTEM_PROMPT),
            ChatMessage(
                role="user",
                content=f"问题：{request.query}\n\n证据：\n{evidence}",
            ),
        ],
        output_mode=OutputMode.json_schema,
        role=ModelRole.rag,
        profile_override=None,
        temperature=None,
        max_output_tokens=request.max_answer_tokens or 1024,
        schema_name="KnowledgeAnswer",
        json_schema=_ANSWER_SCHEMA,
    )

    output = result.provider_result.output
    assert isinstance(output, dict)
    citation_ids = output.get("citation_ids") or []
    if not isinstance(citation_ids, list) or any(
        not isinstance(item, str) or item not in labels for item in citation_ids
    ):
        # json_schema 只约束格式，引用存在性必须由服务端校验。
        raise AIServiceError(
            "LLM_OUTPUT_INVALID",
            "The provider output referenced citations outside the retrieved chunks",
            status_code=502,
            request_id=request.request_id,
        )

    insufficient = bool(output.get("insufficient_evidence")) or not citation_ids
    if insufficient:
        # 模型自判证据不足或没有任何引用：服务端拒答，不返回想象内容。
        answer = ""
        citations: list[KnowledgeAnswerCitation] = []
    else:
        answer = str(output.get("answer") or "")
        chunks_by_label = dict(zip(labels, retrieved.chunks, strict=True))
        citations = [
            _to_citation(label, chunks_by_label[label])
            for label in dict.fromkeys(citation_ids)
        ]
        if not answer:
            # 声称能回答却只有空文本，视为无效输出。
            raise AIServiceError(
                "LLM_OUTPUT_INVALID",
                "The provider output contained no answer text",
                status_code=502,
                request_id=request.request_id,
            )

    usage = result.provider_result.token_usage
    return KnowledgeAnswerResponse(
        request_id=request.request_id,
        answer=answer,
        grounded=bool(citations),
        insufficient_evidence=insufficient,
        citations=citations,
        execution=ExecutionMetadata(
            profile=result.profile_name,
            provider=Provider(result.profile.provider),
            model=result.profile.model,
            fallback_count=result.fallback_count,
            latency_ms=result.latency_ms,
            finish_reason=result.provider_result.finish_reason,
            token_usage=TokenUsage(
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                total_tokens=usage.total_tokens,
            ),
        ),
        index_version=retrieved.index_version,
        embedding_profile=retrieved.embedding_profile,
    )


def _to_citation(label: str, chunk: RetrievedChunk) -> KnowledgeAnswerCitation:
    return KnowledgeAnswerCitation(
        citation_id=label,
        chunk_id=chunk.chunk_id,
        document_id=chunk.document_id,
        document_version_id=chunk.document_version_id,
        text=chunk.text,
        score=chunk.score,
        page_index=chunk.page_index,
        bbox=chunk.bbox,
        heading_path=chunk.heading_path,
    )
