from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.generated.models import (
    ChatContextBudgets,
    ChatMode,
    HealthResponse,
    ModelRole,
    ReadinessResponse,
    Status,
)
from app.core.runtime import AppRuntime

router = APIRouter(tags=["system"])


@router.get(
    "/health",
    response_model=HealthResponse,
    operation_id="getHealth",
    summary="Process liveness check",
    response_description="Service process is alive",
)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="ai-service")


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    operation_id="getReadiness",
    summary="Configuration readiness check",
    response_description="Service is ready",
    responses={
        503: {
            "model": ReadinessResponse,
            "description": "Service configuration is not ready",
        }
    },
)
async def ready(request: Request) -> ReadinessResponse | JSONResponse:
    runtime: AppRuntime = request.app.state.runtime
    chat_config = runtime.catalog.chat if runtime.catalog is not None else None
    chat_context_budgets = None
    if chat_config is not None:
        budgets = {
            mode.value: policy.context_budget_tokens
            for mode, policy in chat_config.modes.items()
        }
        chat_context_budgets = ChatContextBudgets(
            standard=budgets.get("standard"),
            ultra=budgets.get("ultra"),
        )
    response = ReadinessResponse(
        status=Status.ready if runtime.ready else Status.not_ready,
        service="ai-service",
        configured_roles=[ModelRole(role) for role in runtime.configured_roles],
        configured_chat_modes=[ChatMode(mode) for mode in runtime.configured_chat_modes],
        errors=runtime.readiness_errors,
        knowledge_index=(
            runtime.knowledge_store.describe()
            if runtime.knowledge_store is not None
            else None
        ),
        chat_context_budgets=chat_context_budgets,
    )
    if runtime.ready:
        return response
    return JSONResponse(status_code=503, content=response.model_dump(mode="json", by_alias=True))
