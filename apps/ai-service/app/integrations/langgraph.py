from __future__ import annotations

from dataclasses import dataclass

from app.llm.router import LLMRouter


@dataclass(frozen=True)
class WorkflowRuntimeContext:
    """Minimal LangGraph runtime context for future domain-owned graphs."""

    llm_router: LLMRouter
