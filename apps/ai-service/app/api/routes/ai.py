from uuid import uuid4

from fastapi import APIRouter

from app.api.schemas.common import TaskDraft
from app.api.schemas.requests import (
    DashboardBriefingRequest,
    DocumentIndexRequest,
    KnowledgeQueryRequest,
    MeetingParseRequest,
    MeetingSummarizeRequest,
    WorkRecordExtractRequest,
)
from app.api.schemas.responses import (
    DashboardBriefingResponse,
    DocumentIndexResponse,
    KnowledgeQueryResponse,
    MeetingParseResponse,
    MeetingSummarizeResponse,
    WorkRecordExtractResponse,
)
from app.core.config import get_settings
from app.repositories.vector_store_repository import PgVectorStoreRepository
from app.services.rag_service import RagService
from app.workflows.meeting_assistant_graph import build_meeting_assistant_graph
from app.workflows.work_record_graph import build_work_record_graph

router = APIRouter(prefix="/ai")


@router.post("/work-record/extract", response_model=WorkRecordExtractResponse)
async def extract_work_record(request: WorkRecordExtractRequest) -> WorkRecordExtractResponse:
    result = await build_work_record_graph().ainvoke({"text": request.text})
    return WorkRecordExtractResponse(
        report_draft=result["report_draft"],
        task_drafts=[TaskDraft(**item) for item in result["task_drafts"]],
        extracted_entities=result["entities"], risks=[], confidence=0.5,
        warnings=["当前使用 mock provider，正式写入前必须由用户确认"],
    )


@router.post("/knowledge/query", response_model=KnowledgeQueryResponse)
async def query_knowledge(request: KnowledgeQueryRequest) -> KnowledgeQueryResponse:
    settings = get_settings()
    return await RagService(PgVectorStoreRepository(settings.database_url)).query(request)


@router.post("/meeting/parse", response_model=MeetingParseResponse)
async def parse_meeting(request: MeetingParseRequest) -> MeetingParseResponse:
    result = await build_meeting_assistant_graph().ainvoke(
        {"instruction": request.natural_language_instruction, "organization_context": request.organization_context}
    )
    return MeetingParseResponse(
        meeting_draft=result["meeting_draft"], notification_draft=result["notification_draft"],
        missing_fields=result["missing_fields"], warnings=["会议和通知均为待确认草稿"],
    )


@router.post("/meeting/summarize", response_model=MeetingSummarizeResponse)
async def summarize_meeting(request: MeetingSummarizeRequest) -> MeetingSummarizeResponse:
    return MeetingSummarizeResponse(
        minutes_draft={"meeting_id": request.meeting_id, "summary": request.transcript_text},
        decisions=[], action_item_drafts=[], risks=[], citations_or_evidence=[request.transcript_text[:200]],
    )


@router.post("/dashboard/generate-briefing", response_model=DashboardBriefingResponse)
async def generate_briefing(request: DashboardBriefingRequest) -> DashboardBriefingResponse:
    resource_ids = [str(item["id"]) for item in request.overdue_tasks + request.blocked_tasks if "id" in item]
    return DashboardBriefingResponse(
        executive_summary=f"{request.report_period} 管理简报，指标来源于 NestJS 已计算快照。",
        key_changes=[f"{key}: {value}" for key, value in request.dashboard_metrics.items()],
        risks=[str(item.get("title", item.get("id", "未命名风险"))) for item in request.blocked_tasks],
        suggested_actions=["复核超期与阻塞任务负责人及截止日期"],
        referenced_resource_ids=resource_ids,
    )


@router.post("/documents/index", response_model=DocumentIndexResponse, status_code=202)
async def index_document(request: DocumentIndexRequest) -> DocumentIndexResponse:
    # TODO: Queue parse -> OCR provider -> LlamaIndex chunk -> embedding -> pgvector ingestion.
    return DocumentIndexResponse(index_job_id=f"idx_{uuid4().hex}", status="QUEUED")