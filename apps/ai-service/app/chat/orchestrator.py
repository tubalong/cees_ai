from __future__ import annotations

from dataclasses import dataclass

from app.api.generated.models import ChatContextUsage, ChatRequest
from app.chat.context import BuiltChatContext, build_chat_context
from app.core.config import ChatMode, ChatModePolicy, ModelCatalog, OutputMode
from app.core.errors import AIServiceError
from app.llm.router import LLMRouter, RoutingResult


@dataclass(frozen=True)
class PreparedChat:
    mode: ChatMode
    policy: ChatModePolicy
    context: BuiltChatContext
    max_output_tokens: int


@dataclass(frozen=True)
class ChatInvocation:
    mode: ChatMode
    context_usage: ChatContextUsage
    routing: RoutingResult


class ChatOrchestrator:
    def __init__(self, router: LLMRouter) -> None:
        self.router = router

    def prepare(self, request: ChatRequest) -> PreparedChat:
        mode = ChatMode(request.mode or ChatMode.standard)
        policy = self._mode_policy(self.router.catalog, mode, request.request_id)
        max_output_tokens = request.max_output_tokens or policy.default_max_output_tokens
        if max_output_tokens > policy.max_output_tokens_limit:
            raise AIServiceError(
                "INVALID_CHAT_REQUEST",
                f"max_output_tokens exceeds the limit for chat mode {mode.value}",
                status_code=422,
                request_id=request.request_id,
            )
        return PreparedChat(
            mode=mode,
            policy=policy,
            context=build_chat_context(request, policy),
            max_output_tokens=max_output_tokens,
        )

    async def invoke(self, request: ChatRequest) -> ChatInvocation:
        prepared = self.prepare(request)
        routing = await self.router.invoke(
            request_id=request.request_id,
            tenant_id=request.tenant_id,
            user_id=request.user_id,
            messages=prepared.context.messages,
            output_mode=OutputMode.text,
            role=prepared.policy.role,
            profile_override=None,
            temperature=None,
            max_output_tokens=prepared.max_output_tokens,
            reasoning_effort=prepared.policy.reasoning_effort,
        )
        if (
            not isinstance(routing.provider_result.output, str)
            or not routing.provider_result.output.strip()
        ):
            raise AIServiceError(
                "CHAT_OUTPUT_INVALID",
                "The provider did not return a text chat response",
                status_code=502,
                request_id=request.request_id,
            )
        return ChatInvocation(
            mode=prepared.mode,
            context_usage=prepared.context.usage,
            routing=routing,
        )

    @staticmethod
    def _mode_policy(catalog: ModelCatalog, mode: ChatMode, request_id: str) -> ChatModePolicy:
        if catalog.chat is None:
            raise AIServiceError(
                "AI_SERVICE_NOT_READY",
                "Chat configuration is not ready",
                status_code=503,
                retryable=True,
                request_id=request_id,
            )
        policy = catalog.chat.modes.get(mode)
        if policy is None:
            raise AIServiceError(
                "CHAT_MODE_UNAVAILABLE",
                f"Chat mode {mode.value} is not configured",
                status_code=503,
                retryable=True,
                request_id=request_id,
            )
        return policy
