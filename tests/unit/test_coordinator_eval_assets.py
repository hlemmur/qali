from __future__ import annotations

import json
import runpy
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from app.slack_coordinator import (
    CoordinatorDecision,
    CoordinatorRequest,
    CoordinatorStatus,
    CoordinatorWorkflow,
)

_EVAL_ROOT = Path(__file__).parents[1] / "eval"
_DATASET = _EVAL_ROOT / "datasets" / "coordinator-routing.json"
_HELD_OUT_DATASET = _EVAL_ROOT / "datasets" / "held-out" / "coordinator-routing.json"


def _content_text(content: dict[str, Any]) -> str:
    return cast(str, content["parts"][0]["text"])


def _load_cases(path: Path = _DATASET) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text())
    return cast(list[dict[str, Any]], payload["eval_cases"])


def test_coordinator_eval_dataset_covers_routes_and_fail_closed_clarification() -> None:
    cases = _load_cases()

    requests = [
        CoordinatorRequest.model_validate_json(_content_text(case["prompt"]))
        for case in cases
    ]
    decisions = [
        CoordinatorDecision.model_validate_json(
            _content_text(case["reference"]["response"])
        )
        for case in cases
    ]

    assert len({case["eval_case_id"] for case in cases}) == len(cases)
    assert {decision.workflow for decision in decisions if decision.workflow} == set(
        CoordinatorWorkflow
    )
    assert (
        sum(
            decision.status is CoordinatorStatus.NEEDS_CLARIFICATION
            for decision in decisions
        )
        >= 3
    )
    assert any(not request.project_ready for request in requests)
    assert any(request.known_finding_ids for request in requests)


def test_held_out_coordinator_cases_are_typed_and_disjoint() -> None:
    core_cases = _load_cases()
    held_out_cases = _load_cases(_HELD_OUT_DATASET)

    for case in held_out_cases:
        CoordinatorRequest.model_validate_json(_content_text(case["prompt"]))
        CoordinatorDecision.model_validate_json(
            _content_text(case["reference"]["response"])
        )

    assert {case["eval_case_id"] for case in core_cases}.isdisjoint(
        case["eval_case_id"] for case in held_out_cases
    )


def test_coordinator_route_metric_requires_the_exact_typed_decision() -> None:
    [case] = [
        candidate
        for candidate in _load_cases()
        if candidate["eval_case_id"] == "one_ready_feature"
    ]
    evaluate = cast(
        Callable[[dict[str, Any]], dict[str, Any]],
        runpy.run_path(str(_EVAL_ROOT / "coordinator_routing.py"))["evaluate"],
    )
    instance = {
        "response": case["reference"]["response"],
        "reference": case["reference"],
    }

    assert evaluate(instance) == {
        "score": 1,
        "explanation": "coordinator decision matched the expected typed route",
    }

    instance["response"] = {
        "role": "model",
        "parts": [
            {
                "text": CoordinatorDecision(
                    status=CoordinatorStatus.READY,
                    workflow=CoordinatorWorkflow.ONBOARD_PROJECT,
                ).model_dump_json()
            }
        ],
    }
    assert evaluate(instance) == {
        "score": 0,
        "explanation": "coordinator decision did not match the expected typed route",
    }


def test_coordinator_route_metric_rejects_non_schema_output() -> None:
    evaluate = cast(
        Callable[[dict[str, Any]], dict[str, Any]],
        runpy.run_path(str(_EVAL_ROOT / "coordinator_routing.py"))["evaluate"],
    )

    assert evaluate(
        {
            "response": {"role": "model", "parts": [{"text": "test_feature"}]},
            "reference": {
                "response": {
                    "role": "model",
                    "parts": [
                        {
                            "text": CoordinatorDecision(
                                status=CoordinatorStatus.READY,
                                workflow=CoordinatorWorkflow.TEST_FEATURE,
                            ).model_dump_json()
                        }
                    ],
                }
            },
        }
    ) == {
        "score": 0,
        "explanation": "coordinator response was not a valid typed decision",
    }
