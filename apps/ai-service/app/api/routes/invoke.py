from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.generated.models import (
    ExecutionMetadata,
    InvokeRequest,
    InvokeResponse,
    JsonOutput,
    JsonSchemaResponseFormat,
    Provider,
    TextOutput,
    TokenUsage,
)
from app.core.config import ModelRole, OutputMode
from app.core.errors import AIServiceError
from app.core.runtime import AppRuntime
from app.core.security import require_internal_token
from app.llm.types import ChatMessage

router = APIRouter(
    prefix="/internal/v1/llm",
    dependencies=[Depends(require_internal_token)],
)


@router.post("/invoke", response_model=InvokeResponse)
async def invoke_llm(payload: InvokeRequest, request: Request) -> InvokeResponse:
    runtime: AppRuntime = request.app.state.runtime
    if not runtime.ready or runtime.router is None:
        raise AIServiceError(
            "AI_SERVICE_NOT_READY",
            "AI service configuration is not ready",
            status_code=503,
            retryable=True,
            request_id=payload.request_id,
        )

    total_message_bytes = sum(len(message.content.encode("utf-8")) for message in payload.messages)
    if total_message_bytes > 256 * 1024:
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "Message content exceeds 256 KiB",
            status_code=422,
            request_id=payload.request_id,
        )

    is_structured = isinstance(payload.response_format, JsonSchemaResponseFormat)
    output_mode = OutputMode.json_schema if is_structured else OutputMode.text
    default_role = ModelRole.structured if is_structured else ModelRole.default
    role = ModelRole(payload.role.value) if payload.role is not None else default_role
    schema_name = payload.response_format.name if is_structured else None
    json_schema = payload.response_format.schema_ if is_structured else None

    result = await runtime.router.invoke(
        request_id=payload.request_id,
        tenant_id=payload.tenant_id,
        user_id=payload.user_id,
        messages=[
            ChatMessage(role=message.role.value, content=message.content)
            for message in payload.messages
        ],
        output_mode=output_mode,
        role=role,
        profile_override=payload.llm_profile,
        temperature=payload.temperature,
        max_output_tokens=payload.max_output_tokens,
        schema_name=schema_name,
        json_schema=json_schema,
    )

    output = (
        JsonOutput(type="json", value=result.provider_result.output)
        if isinstance(result.provider_result.output, dict)
        else TextOutput(type="text", text=result.provider_result.output)
    )
    usage = result.provider_result.token_usage
    return InvokeResponse(
        request_id=payload.request_id,
        output=output,
        execution=ExecutionMetadata(
            profile=result.profile_name,
            provider=Provider(result.profile.provider),
            model=result.profile.model,
            fallback_count=result.fallback_count,
            latency_ms=result.latency_ms,
            token_usage=TokenUsage(
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                total_tokens=usage.total_tokens,
            ),
        ),
    )
