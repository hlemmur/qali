from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.failure_investigation import (
    FailureAnalysisTask,
    FailureAttempt,
    FailureInvestigationResult,
    FailureInvestigationWorkflow,
    FailureReview,
    build_failure_analysis_task,
)
from app.oracle_evaluation import OracleCheckStatus
from tests.integration.test_failure_investigation_workflow import (
    _analysis,
    _attempt,
    _evidence,
    _InvestigatorDouble,
    _ReproducerDouble,
    _result,
    _ReviewerDouble,
    _task,
)


def test_attempt_rejects_a_verdict_that_disagrees_with_its_checks() -> None:
    inconsistent = _result(passed=False).model_copy(
        update={
            "evaluation": _result(passed=True).evaluation.model_copy(
                update={"passed": False}
            )
        }
    )

    with pytest.raises(ValidationError, match="verdict must match"):
        FailureAttempt(
            context_id="context-invalid",
            result=inconsistent,
            evidence=_evidence("invalid"),
        )


def test_analysis_task_rejects_forged_fingerprints() -> None:
    valid = build_failure_analysis_task(
        _task(),
        _attempt(passed=False, run="reproduction"),
    )
    payload = valid.model_dump(mode="python")
    payload["initial_fingerprint"] = "f" * 16

    with pytest.raises(ValidationError, match="fingerprints do not match"):
        FailureAnalysisTask.model_validate(payload)


def test_failed_attempt_requires_at_least_one_failed_check() -> None:
    result = _result(passed=True).model_copy(
        update={
            "evaluation": _result(passed=True).evaluation.model_copy(
                update={
                    "passed": False,
                    "checks": tuple(
                        check.model_copy(update={"status": OracleCheckStatus.PASSED})
                        for check in _result(passed=True).evaluation.checks
                    ),
                }
            )
        }
    )

    with pytest.raises(ValidationError, match="verdict must match"):
        FailureAttempt(
            context_id="context-invalid",
            result=result,
            evidence=_evidence("invalid"),
        )


@pytest.mark.asyncio
async def test_approved_investigation_cannot_drop_its_finding() -> None:
    result = await FailureInvestigationWorkflow(
        reproducer=_ReproducerDouble(_attempt(passed=False, run="reproduction")),
        investigator=_InvestigatorDouble([_analysis()]),
        reviewer=_ReviewerDouble([FailureReview(approved=True, feedback=())]),
    ).run(_task())
    payload = result.model_dump(mode="python")
    payload["finding"] = None

    with pytest.raises(ValidationError, match="status is inconsistent"):
        FailureInvestigationResult.model_validate(payload)


@pytest.mark.asyncio
async def test_finding_identity_cannot_be_decoupled_from_failed_checks() -> None:
    result = await FailureInvestigationWorkflow(
        reproducer=_ReproducerDouble(_attempt(passed=False, run="reproduction")),
        investigator=_InvestigatorDouble([_analysis()]),
        reviewer=_ReviewerDouble([FailureReview(approved=True, feedback=())]),
    ).run(_task())
    payload = result.model_dump(mode="python")
    payload["finding"]["finding_id"] = "finding-ffffffffffffffff"

    with pytest.raises(ValidationError, match="identity does not match"):
        FailureInvestigationResult.model_validate(payload)
