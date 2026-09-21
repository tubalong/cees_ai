from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from app.api.generated.models import CompactChatRequest
from app.chat.context import build_compaction_context
from app.chat.follow_up import parse_memory_candidate
from app.core.config import OutputMode
from app.core.errors import AIServiceError
from app.llm.router import LLMRouter, RoutingResult

MEMORY_BLOCK_OPEN = "<user_memories>"
MEMORY_BLOCK_CLOSE = "</user_memories>"


@dataclass(frozen=True)
class ChatCompaction:
    summary: str
    summarized_through_message_id: str | None
    memory_candidates: list[dict[str, Any]]
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
        if not isinstance(output, str):
            raise AIServiceError(
                "CHAT_SUMMARY_INVALID",
                "The provider did not return a valid conversation summary",
                status_code=502,
                request_id=request.request_id,
                execution=routing,
            )
        summary, memory_candidates = _split_compaction_output(output)
        if not summary.strip():
            raise AIServiceError(
                "CHAT_SUMMARY_INVALID",
                "The provider did not return a valid conversation summary",
                status_code=502,
                request_id=request.request_id,
                execution=routing,
            )
        return ChatCompaction(
            summary=summary.strip(),
            summarized_through_message_id=context.summarized_through_message_id,
            memory_candidates=memory_candidates,
            routing=routing,
        )


def _split_compaction_output(
    output: str,
) -> tuple[str, list[dict[str, Any]]]:
    """剥离压缩输出中的记忆块，返回 (摘要文本, 记忆候选)；无块或解析失败时候选为空。"""
    match = re.search(
        re.escape(MEMORY_BLOCK_OPEN) + r"(.*?)" + re.escape(MEMORY_BLOCK_CLOSE),
        output,
        flags=re.DOTALL,
    )
    if not match:
        return output, []
    summary = output[: match.start()] + output[match.end():]
    try:
        parsed = json.loads(match.group(1).strip())
    except ValueError:
        return summary, []
    if not isinstance(parsed, list):
        return summary, []
    candidates: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        candidate = parse_memory_candidate(item)
        if candidate is None:
            continue
        candidates.append(candidate)
    return summary, candidates[:3]
