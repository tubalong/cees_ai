from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph


class WorkRecordState(TypedDict, total=False):
    text: str
    entities: dict[str, Any]
    report_draft: dict[str, Any]
    task_drafts: list[dict[str, Any]]


def extract_entities(state: WorkRecordState) -> WorkRecordState:
    return {**state, "entities": {"raw_text": state["text"]}}


def build_drafts(state: WorkRecordState) -> WorkRecordState:
    return {**state, "report_draft": {"summary": state["text"]}, "task_drafts": []}


def build_work_record_graph():
    graph = StateGraph(WorkRecordState)
    graph.add_node("extract_entities", extract_entities)
    graph.add_node("build_drafts", build_drafts)
    graph.add_edge(START, "extract_entities")
    graph.add_edge("extract_entities", "build_drafts")
    graph.add_edge("build_drafts", END)
    return graph.compile()