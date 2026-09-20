from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.api.generated.models import RelatedQuestionsRequest
from app.core.config import OutputMode
from app.core.errors import AIServiceError
from app.llm.router import LLMRouter, RoutingResult
from app.llm.types import ChatMessage

MAX_QUESTION_COUNT = 3
MAX_QUESTION_CHARS = 30

RELATED_QUESTIONS_SYSTEM_PROMPT = """你负责为一次 AI 问答生成后续追问建议。
根据用户消息与 AI 答复，生成至多 3 条用户可能想继续追问的简短问题。
要求：每条问题是一句简短的话，不超过 30 个字；与当前答复直接相关；不重复已回答的内容。
只输出 JSON 字符串数组，例如 ["怎么申请试用？", "有免费额度吗？"]，不要输出任何其他内容。"""


@dataclass(frozen=True)
class RelatedQuestionsGeneration:
    questions: list[str]
    routing: RoutingResult


class RelatedQuestionsGenerator:
    def __init__(self, router: LLMRouter) -> None:
        self.router = router

    async def generate(self, request: RelatedQuestionsRequest) -> RelatedQuestionsGeneration:
        config = self.router.catalog.chat
        if config is None:
            raise AIServiceError(
                "AI_SERVICE_NOT_READY",
                "Chat configuration is not ready",
                status_code=503,
                retryable=True,
                request_id=request.request_id,
            )
        user_input = json.dumps(
            {
                "user_message": request.user_message,
                "assistant_reply": request.assistant_reply,
            },
            ensure_ascii=False,
        )
        routing = await self.router.invoke(
            request_id=request.request_id,
            tenant_id=request.tenant_id,
            user_id=request.user_id,
            messages=[
                ChatMessage(role="system", content=RELATED_QUESTIONS_SYSTEM_PROMPT),
                ChatMessage(role="user", content=user_input),
            ],
            output_mode=OutputMode.text,
            role=config.related_questions_role,
            profile_override=None,
            temperature=None,
            max_output_tokens=config.related_questions_max_output_tokens,
        )
        if routing.provider_result.finish_reason == "length":
            raise AIServiceError(
                "RELATED_QUESTIONS_TRUNCATED",
                "Related questions generation reached the output token limit",
                status_code=502,
                request_id=request.request_id,
                execution=routing,
            )
        output = routing.provider_result.output
        questions = _parse_questions(output) if isinstance(output, str) else []
        if not questions:
            raise AIServiceError(
                "RELATED_QUESTIONS_INVALID",
                "The provider did not return valid follow-up questions",
                status_code=502,
                request_id=request.request_id,
                execution=routing,
            )
        return RelatedQuestionsGeneration(questions=questions, routing=routing)


def _parse_questions(output: str) -> list[str]:
    stripped = output.strip()
    candidates: list[str] = []
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", stripped, flags=re.DOTALL)
        if not match:
            return []
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(parsed, list):
        return []
    for item in parsed:
        if not isinstance(item, str):
            continue
        question = item.strip()
        if not question or len(question) > MAX_QUESTION_CHARS:
            continue
        candidates.append(question)
    return candidates[:MAX_QUESTION_COUNT]
