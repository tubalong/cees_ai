from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph


class MeetingState(TypedDict, total=False):
    instruction: str
    organization_context: dict[str, Any]
    meeting_draft: dict[str, Any]
    missing_fields: list[str]
    notification_draft: dict[str, Any]


def parse_instruction(state: MeetingState) -> MeetingState:
    return {**state, "meeting_draft": {"title": state["instruction"]}}


def check_required_fields(state: MeetingState) -> MeetingState:
    meeting = state["meeting_draft"]
    missing = [field for field in ("starts_at", "duration_minutes") if not meeting.get(field)]
    return {
        **state,
        "missing_fields": missing,
        "notification_draft": {"title": meeting["title"], "status": "DRAFT"},
    }


def build_meeting_assistant_graph():
    graph = StateGraph(MeetingState)
    graph.add_node("parse_instruction", parse_instruction)
    graph.add_node("check_required_fields", check_required_fields)
    graph.add_edge(START, "parse_instruction")
    graph.add_edge("parse_instruction", "check_required_fields")
    graph.add_edge("check_required_fields", END)
    return graph.compile()