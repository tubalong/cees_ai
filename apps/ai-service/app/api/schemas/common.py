from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class AIRequest(StrictModel):
    request_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)


class Citation(StrictModel):
    document_name: str
    document_id: str
    location: str
    quote: str


class TaskDraft(StrictModel):
    title: str
    description: str = ""
    suggested_assignee: str | None = None
    suggested_due_date: str | None = None
    confidence: float = Field(ge=0, le=1)


JsonObject = dict[str, Any]