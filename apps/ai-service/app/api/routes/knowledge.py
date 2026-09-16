from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.generated.models import (
    ErrorResponse,
    KnowledgeIndexDeleteRequest,
    KnowledgeIndexDeleteResponse,
    KnowledgeIndexRequest,
    KnowledgeIndexResponse,
    KnowledgeRetrieveRequest,
    KnowledgeRetrieveResponse,
)
from app.core.errors import AIServiceError
from app.core.runtime import AppRuntime
from app.core.security import require_internal_token
from app.knowledge.deletion import delete_document_index
from app.knowledge.ingestion import index_document
from app.knowledge.retrieval import retrieve_chunks

router = APIRouter(
    prefix="/internal/v1/knowledge",
    tags=["knowledge"],
    dependencies=[Depends(require_internal_token)],
)


def _responses() -> dict[int, dict[str, object]]:
    # description 必须与契约 components/responses 中同名组件的文案一致，
    # 契约漂移测试会逐状态比对。
    return {
        400: {
            "model": ErrorResponse,
            "description": "Invalid profile or unsupported output mode",
        },
        401: {
            "model": ErrorResponse,
            "description": "Internal authentication failed",
        },
        422: {
            "model": ErrorResponse,
            "description": "Request validation failed",
        },
        500: {
            "model": ErrorResponse,
            "description": "Unexpected internal service error",
        },
        503: {
            "model": ErrorResponse,
            "description": "Service or configured providers unavailable",
        },
    }


@router.post(
    "/index",
    response_model=KnowledgeIndexResponse,
    operation_id="indexKnowledgeDocument",
    summary="Index a parsed knowledge document",
    response_description="Document indexed idempotently",
    responses=_responses(),
)
async def index_knowledge(
    payload: KnowledgeIndexRequest, request: Request
) -> KnowledgeIndexResponse:
    runtime: AppRuntime = request.app.state.runtime
    store = runtime.knowledge_store
    embedding_router = runtime.embedding_router
    if store is None or embedding_router is None:
        raise AIServiceError(
            "KNOWLEDGE_NOT_READY",
            "Knowledge index and retrieval are not ready",
            status_code=503,
            retryable=True,
            request_id=payload.request_id,
        )
    try:
        return await index_document(
            payload, store=store, embedding_router=embedding_router
        )
    except (KeyError, ValueError) as exc:
        raise AIServiceError(
            "INVALID_KNOWLEDGE_INDEX_REQUEST",
            str(exc),
            status_code=400,
            retryable=False,
            request_id=payload.request_id,
        ) from exc


@router.post(
    "/retrieve",
    response_model=KnowledgeRetrieveResponse,
    operation_id="retrieveKnowledge",
    summary="Retrieve knowledge chunks within a trusted scope",
    response_description="Chunks retrieved within the trusted scope",
    responses=_responses(),
)
async def retrieve_knowledge(
    payload: KnowledgeRetrieveRequest, request: Request
) -> KnowledgeRetrieveResponse:
    runtime: AppRuntime = request.app.state.runtime
    store = runtime.knowledge_store
    embedding_router = runtime.embedding_router
    if store is None or embedding_router is None:
        raise AIServiceError(
            "KNOWLEDGE_NOT_READY",
            "Knowledge index and retrieval are not ready",
            status_code=503,
            retryable=True,
            request_id=payload.request_id,
        )
    try:
        return await retrieve_chunks(
            payload, store=store, embedding_router=embedding_router
        )
    except KeyError as exc:
        raise AIServiceError(
            "INVALID_KNOWLEDGE_RETRIEVE_REQUEST",
            str(exc),
            status_code=400,
            retryable=False,
            request_id=payload.request_id,
        ) from exc


@router.post(
    "/index/delete",
    response_model=KnowledgeIndexDeleteResponse,
    operation_id="deleteKnowledgeIndex",
    summary="Delete derived index of a document version",
    response_description="Derived index deleted",
    responses=_responses(),
)
async def delete_knowledge_index(
    payload: KnowledgeIndexDeleteRequest, request: Request
) -> KnowledgeIndexDeleteResponse:
    runtime: AppRuntime = request.app.state.runtime
    store = runtime.knowledge_store
    if store is None:
        raise AIServiceError(
            "KNOWLEDGE_NOT_READY",
            "Knowledge index and retrieval are not ready",
            status_code=503,
            retryable=True,
            request_id=payload.request_id,
        )
    return await delete_document_index(payload, store=store)
