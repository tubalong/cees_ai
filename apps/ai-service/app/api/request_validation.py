from __future__ import annotations

from collections.abc import Sequence

from app.api.generated.models import InvokeMessage
from app.api.message_content import message_content_to_internal
from app.core.errors import AIServiceError
from app.llm.types import content_size_bytes


def validate_message_content_size(
    messages: Sequence[InvokeMessage], request_id: str
) -> None:
    total_message_bytes = sum(
        content_size_bytes(message_content_to_internal(message.content))
        for message in messages
    )
    if total_message_bytes > 256 * 1024:
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "Message content exceeds 256 KiB",
            status_code=422,
            request_id=request_id,
        )
