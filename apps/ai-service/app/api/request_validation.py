from __future__ import annotations

from collections.abc import Sequence

from app.api.generated.models import InvokeMessage
from app.core.errors import AIServiceError


def validate_message_content_size(
    messages: Sequence[InvokeMessage], request_id: str
) -> None:
    total_message_bytes = sum(len(message.content.encode("utf-8")) for message in messages)
    if total_message_bytes > 256 * 1024:
        raise AIServiceError(
            "INVALID_INVOCATION_REQUEST",
            "Message content exceeds 256 KiB",
            status_code=422,
            request_id=request_id,
        )