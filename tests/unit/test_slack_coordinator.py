from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.slack_coordinator import (
    CoordinatorDecision,
    CoordinatorRequest,
    CoordinatorStatus,
    CoordinatorWorkflow,
    validate_coordinator_decision,
)


def _request(*, project_ready: bool = True) -> CoordinatorRequest:
    return CoordinatorRequest(
        project_id="project-alpha",
        request_text="Could you explain finding-0123456789abcdef?",
        project_ready=project_ready,
        known_finding_ids=("finding-0123456789abcdef",),
    )


def test_coordinator_accepts_a_grounded_finding_route() -> None:
    decision = CoordinatorDecision(
        status=CoordinatorStatus.READY,
        workflow=CoordinatorWorkflow.EXPLAIN_FINDING,
        finding_id="finding-0123456789abcdef",
    )

    assert validate_coordinator_decision(decision, request=_request()) == decision


def test_coordinator_rejects_an_unknown_finding_route() -> None:
    decision = CoordinatorDecision(
        status=CoordinatorStatus.READY,
        workflow=CoordinatorWorkflow.EXPLAIN_FINDING,
        finding_id="finding-fedcba9876543210",
    )

    with pytest.raises(ValueError, match="known finding"):
        validate_coordinator_decision(decision, request=_request())


def test_coordinator_rejects_feature_testing_before_onboarding() -> None:
    decision = CoordinatorDecision(
        status=CoordinatorStatus.READY,
        workflow=CoordinatorWorkflow.TEST_FEATURE,
    )

    with pytest.raises(ValueError, match="ready project"):
        validate_coordinator_decision(decision, request=_request(project_ready=False))


def test_coordinator_clarification_cannot_dispatch_a_workflow() -> None:
    with pytest.raises(ValidationError):
        CoordinatorDecision(
            status=CoordinatorStatus.NEEDS_CLARIFICATION,
            workflow=CoordinatorWorkflow.TEST_FEATURE,
            clarification_question="Which one feature should Qali test?",
        )


def test_coordinator_route_cannot_include_unrelated_fields() -> None:
    with pytest.raises(ValidationError):
        CoordinatorDecision(
            status=CoordinatorStatus.READY,
            workflow=CoordinatorWorkflow.ONBOARD_PROJECT,
            finding_id="finding-0123456789abcdef",
        )
