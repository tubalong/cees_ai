from typing import Any

from pydantic import Field

from app.api.schemas.common import Citation, StrictModel, TaskDraft


class WorkRecordExtractResponse(StrictModel):
    report_draft: dict[str, Any]
    task_drafts: list[TaskDraft]
    extracted_entities: dict[str, Any]
    risks: list[str]
    confidence: float = Field(ge=0, le=1)
    warnings: list[str]


class KnowledgeQueryResponse(StrictModel):
    answer: str
    citations: list[Citation]
    confidence: float = Field(ge=0, le=1)
    no_answer_reason: str | None = None


class MeetingParseResponse(StrictModel):
    meeting_draft: dict[str, Any]
    notification_draft: dict[str, Any]
    missing_fields: list[str]
    warnings: list[str]


class MeetingSummarizeResponse(StrictModel):
    minutes_draft: dict[str, Any]
    decisions: list[str]
    action_item_drafts: list[TaskDraft]
    risks: list[str]
    citations_or_evidence: list[str]


class DashboardBriefingResponse(StrictModel):
    executive_summary: str
    key_changes: list[str]
    risks: list[str]
    suggested_actions: list[str]
    referenced_resource_ids: list[str]


class DocumentIndexResponse(StrictModel):
    index_job_id: str
    status: str