"""Deterministic route-contract metric for coordinator evaluation traces."""

from __future__ import annotations

from typing import Any

from app.slack_coordinator import CoordinatorDecision, CoordinatorStatus


def _text(content: dict[str, Any]) -> str:
    parts = content["parts"]
    if not isinstance(parts, list) or len(parts) != 1:
        raise ValueError("decision content must contain exactly one part")
    text = parts[0]["text"]
    if not isinstance(text, str):
        raise ValueError("decision content must be text")
    return text


def evaluate(instance: dict[str, Any]) -> dict[str, Any]:
    try:
        actual = CoordinatorDecision.model_validate_json(_text(instance["response"]))
        expected = CoordinatorDecision.model_validate_json(
            _text(instance["reference"]["response"])
        )
    except (KeyError, TypeError, ValueError):
        return {
            "score": 0,
            "explanation": "coordinator response was not a valid typed decision",
        }

    route_matches = (
        actual.status is expected.status
        and actual.workflow is expected.workflow
        and actual.finding_id == expected.finding_id
    )
    clarification_matches = (
        expected.status is not CoordinatorStatus.NEEDS_CLARIFICATION
        or actual.clarification_question is not None
    )
    if route_matches and clarification_matches:
        return {
            "score": 1,
            "explanation": "coordinator decision matched the expected typed route",
        }
    return {
        "score": 0,
        "explanation": "coordinator decision did not match the expected typed route",
    }
