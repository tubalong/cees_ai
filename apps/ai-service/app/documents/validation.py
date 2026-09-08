from __future__ import annotations

from app.api.generated.models import DocumentPlan, DocumentSpec, TableBlock
from app.core.errors import AIServiceError


def validate_document_spec(
    document: DocumentSpec,
    *,
    request_id: str,
    status_code: int,
    allowed_source_refs: set[str] | None = None,
) -> None:
    source_refs = list(document.source_refs)
    if len(source_refs) != len(set(source_refs)):
        _raise_invalid("Document source references must be unique", request_id, status_code)

    if allowed_source_refs is not None:
        unknown_refs = set(source_refs) - allowed_source_refs
        if unknown_refs:
            _raise_invalid(
                "Document references source material that was not provided",
                request_id,
                status_code,
            )

    for section in document.sections:
        for block in section.blocks:
            if isinstance(block, TableBlock) and any(
                len(row) != len(block.columns) for row in block.rows
            ):
                _raise_invalid(
                    "Document table rows must match the column count",
                    request_id,
                    status_code,
                )


def validate_document_plan(
    plan: DocumentPlan,
    *,
    request_id: str,
    allowed_source_refs: set[str],
) -> None:
    for section in plan.sections:
        source_refs = list(section.source_refs)
        if len(source_refs) != len(set(source_refs)):
            _raise_plan_invalid(
                "Document plan source references must be unique",
                request_id,
            )
        if set(source_refs) - allowed_source_refs:
            _raise_plan_invalid(
                "Document plan references source material that was not provided",
                request_id,
            )


def _raise_plan_invalid(message: str, request_id: str) -> None:
    raise AIServiceError(
        "DOCUMENT_PLAN_INVALID",
        message,
        status_code=502,
        request_id=request_id,
    )


def _raise_invalid(message: str, request_id: str, status_code: int) -> None:
    raise AIServiceError(
        "DOCUMENT_SPEC_INVALID",
        message,
        status_code=status_code,
        request_id=request_id,
    )