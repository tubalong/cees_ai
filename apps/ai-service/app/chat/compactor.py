from __future__ import annotations

from dataclasses import dataclass

from app.api.generated.models import CompactChatRequest
from app.chat.context import build_compaction_context
from app.core.config import OutputMode
from app.core.errors import AIServiceError
from app.llm.router import LLMRouter, RoutingResult


@dataclass(frozen=True)
class ChatCompaction:
    summary: str
    summarized_through_message_id: str | None
    routing: RoutingResult


class ChatCompactor:
    def __init__(self, router: LLMRouter) -> None:
        self.router = router

    async def compact(self, request: CompactChatRequest) -> ChatCompaction:
        config = self.router.catalog.chat
        if config is None:
            raise AIServiceError(
                "AI_SERVICE_NOT_READY",
                "Chat configuration is not ready",
                status_code=503,
                retryable=True,
                request_id=request.request_id,
            )
        context = build_compaction_context(
            request,
            context_budget_tokens=config.compaction_context_budget_tokens,
        )
        routing = await self.router.invoke(
            request_id=request.request_id,
            tenant_id=request.tenant_id,
            user_id=request.user_id,
            messages=context.messages,
            output_mode=OutputMode.text,
            role=config.compaction_role,
            profile_override=None,
            temperature=None,
            max_output_tokens=config.compaction_max_output_tokens,
        )
        if routing.provider_result.finish_reason == "length":
            raise AIServiceError(
                "CHAT_COMPACTION_TRUNCATED",
                "Chat compaction reached the output token limit",
                status_code=502,
                request_id=request.request_id,
                execution=routing,
            )
        output = routing.provider_result.output
        if not isinstance(output, str) or not output.strip():
            raise AIServiceError(
                "CHAT_SUMMARY_INVALID",
                "The provider did not return a valid conversation summary",
                status_code=502,
                request_id=request.request_id,
                execution=routing,
            )
        return ChatCompaction(
            summary=output.strip(),
            summarized_through_message_id=context.summarized_through_message_id,
            routing=routing,
        )
