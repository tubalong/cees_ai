from __future__ import annotations


class AIServiceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        retryable: bool = False,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.request_id = request_id


class ProviderTransientError(Exception):
    """A provider failure that may be retried on a different configured profile."""


class ProviderPermanentError(Exception):
    """A provider failure that must not trigger cross-profile fallback."""


class ProviderOutputError(Exception):
    """The provider response could not be parsed or validated."""
