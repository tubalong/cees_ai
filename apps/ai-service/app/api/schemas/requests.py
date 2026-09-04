from typing import Any

from pydantic import Field

from app.api.schemas.common import AIRequest, StrictModel


class WorkRecordExtractRequest(AIRequest):
    text: str = Field(min_length=1)
    context: dict[str, Any] | None = None


class KnowledgeQueryRequest(AIRequest):
    query: str = Field(min_length=1)
    allowed_knowledge_base_ids: list[str] = Field(min_length=1)
    allowed_document_ids: list[str] | None = None
    permission_filters: dict[str, Any]


class MeetingParseRequest(AIRequest):
    natural_language_instruction: str = Field(min_length=1)
    organization_context: dict[str, Any]


class MeetingSummarizeRequest(AIRequest):
    meeting_id: str
    transcript_text: str = Field(min_length=1)
    meeting_context: dict[str, Any]


class DashboardBriefingRequest(AIRequest):
    dashboard_metrics: dict[str, int | float | str]
    overdue_tasks: list[dict[str, Any]]
    blocked_tasks: list[dict[str, Any]]
    project_summaries: list[dict[str, Any]]
    report_period: str


class DocumentIndexRequest(StrictModel):
    request_id: str
    tenant_id: str
    knowledge_base_id: str
    document_id: str
    file_url: str
    document_metadata: dict[str, Any]