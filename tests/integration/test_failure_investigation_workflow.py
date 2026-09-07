from __future__ import annotations

import pytest

from app.browser_executor_agent import BrowserScenarioResult
from app.failure_investigation import (
    ClassificationConfidence,
    FailureAnalysis,
    FailureAnalysisTask,
    FailureAttempt,
    FailureClassification,
    FailureEvidenceBundle,
    FailureGateStatus,
    FailureInvestigationError,
    FailureInvestigationTask,
    FailureInvestigationWorkflow,
    FailureReview,
    FailureReviewTask,
)
from app.oracle_evaluation import OracleCheck, OracleCheckStatus, OracleEvaluationResult
from tests.integration.test_browser_executor_agent import _execution_task


def _result(*, passed: bool, actual: str = "Original Name") -> BrowserScenarioResult:
    task = _execution_task()
    checks = (
        OracleCheck(
            oracle_id="oracle-name-visible",
            status=(OracleCheckStatus.PASSED if passed else OracleCheckStatus.FAILED),
            expected="Updated Name",
            actual="Updated Name" if passed else actual,
            evidence_ref="evidence://oracle/name",
        ),
        OracleCheck(
            oracle_id="oracle-no-error",
            status=OracleCheckStatus.PASSED,
            expected=None,
            actual=None,
            evidence_ref="evidence://oracle/no-error",
        ),
    )
    return BrowserScenarioResult(
        scenario_id=task.scenario.scenario_id,
        step_count=4,
        evaluation=OracleEvaluationResult(
            passed=passed,
            check_count=len(checks),
            checks=checks,
        ),
    )


def _evidence(run: str) -> FailureEvidenceBundle:
    return FailureEvidenceBundle(
        trace_ref=f"evidence://{run}/trace",
        accessibility_snapshot_ref=f"evidence://{run}/accessibility",
        console_ref=f"evidence://{run}/console",
        network_ref=f"evidence://{run}/network",
        screenshot_ref=f"evidence://{run}/screenshot",
    )


def _attempt(
    *, passed: bool, run: str, actual: str = "Original Name"
) -> FailureAttempt:
    return FailureAttempt(
        result=_result(passed=passed, actual=actual),
        evidence=None if passed else _evidence(run),
    )


def _task() -> FailureInvestigationTask:
    execution_task = _execution_task()
    return FailureInvestigationTask(
        project_id=execution_task.project_id,
        feature_slug="profile-editing",
        execution_task=execution_task,
        initial_attempt=_attempt(passed=False, run="initial"),
    )


class _ReproducerDouble:
    def __init__(self, attempt: FailureAttempt) -> None:
        self._attempt = attempt
        self.tasks = []

    async def reproduce(self, task):
        self.tasks.append(task)
        return self._attempt


class _InvestigatorDouble:
    def __init__(self, analyses: list[FailureAnalysis]) -> None:
        self._analyses = iter(analyses)
        self.tasks: list[FailureAnalysisTask] = []
        self.revisions: list[tuple[FailureAnalysis, tuple[str, ...]]] = []

    async def classify(self, task: FailureAnalysisTask) -> FailureAnalysis:
        self.tasks.append(task)
        return next(self._analyses)

    async def revise(
        self,
        task: FailureAnalysisTask,
        prior: FailureAnalysis,
        feedback: tuple[str, ...],
    ) -> FailureAnalysis:
        assert task == self.tasks[0]
        self.revisions.append((prior, feedback))
        return next(self._analyses)


class _ReviewerDouble:
    def __init__(self, reviews: list[FailureReview]) -> None:
        self._reviews = iter(reviews)
        self.tasks: list[FailureReviewTask] = []

    async def review(self, task: FailureReviewTask) -> FailureReview:
        self.tasks.append(task)
        return next(self._reviews)


def _analysis(
    summary: str = "Saved profile name remains unchanged.",
) -> FailureAnalysis:
    return FailureAnalysis(
        classification=FailureClassification.PRODUCT_DEFECT,
        confidence=ClassificationConfidence.HIGH,
        summary=summary,
        rationale="The same grounded oracle failed in both isolated attempts.",
        failed_oracle_ids=("oracle-name-visible",),
    )


@pytest.mark.asyncio
async def test_non_reproduced_failure_is_inconclusive_without_model_triage() -> None:
    reproducer = _ReproducerDouble(_attempt(passed=True, run="reproduction"))
    investigator = _InvestigatorDouble([])
    reviewer = _ReviewerDouble([])
    workflow = FailureInvestigationWorkflow(
        reproducer=reproducer,
        investigator=investigator,
        reviewer=reviewer,
    )

    result = await workflow.run(_task())

    assert result.status is FailureGateStatus.INCONCLUSIVE
    assert result.analysis.classification is FailureClassification.FLAKY_INCONCLUSIVE
    assert result.finding is None
    assert len(reproducer.tasks) == 1
    assert investigator.tasks == []
    assert reviewer.tasks == []


@pytest.mark.asyncio
async def test_reproduced_failure_becomes_a_reviewed_stable_finding() -> None:
    reproduction = _attempt(passed=False, run="reproduction")
    reproducer = _ReproducerDouble(reproduction)
    investigator = _InvestigatorDouble([_analysis()])
    reviewer = _ReviewerDouble([FailureReview(approved=True, feedback=())])
    workflow = FailureInvestigationWorkflow(
        reproducer=reproducer,
        investigator=investigator,
        reviewer=reviewer,
    )

    first = await workflow.run(_task())
    second = await FailureInvestigationWorkflow(
        reproducer=_ReproducerDouble(reproduction),
        investigator=_InvestigatorDouble([_analysis()]),
        reviewer=_ReviewerDouble([FailureReview(approved=True, feedback=())]),
    ).run(_task())

    assert first.status is FailureGateStatus.APPROVED
    assert first.finding is not None
    assert first.finding.finding_id == second.finding.finding_id
    assert first.finding.fingerprint == second.finding.fingerprint
    assert first.finding.reproduction_count == 1
    assert first.finding.evidence_refs == (
        *_evidence("initial").references(),
        *_evidence("reproduction").references(),
        "evidence://oracle/name",
    )
    assert len(reviewer.tasks) == 1


@pytest.mark.asyncio
async def test_second_review_rejection_escalates_after_one_revision() -> None:
    initial = _analysis()
    revised = _analysis("Profile name still differs from the approved expectation.")
    investigator = _InvestigatorDouble([initial, revised])
    reviewer = _ReviewerDouble(
        [
            FailureReview(approved=False, feedback=("Clarify the observed behavior.",)),
            FailureReview(approved=False, feedback=("Evidence remains ambiguous.",)),
        ]
    )
    workflow = FailureInvestigationWorkflow(
        reproducer=_ReproducerDouble(_attempt(passed=False, run="reproduction")),
        investigator=investigator,
        reviewer=reviewer,
    )

    result = await workflow.run(_task())

    assert result.status is FailureGateStatus.ESCALATED
    assert result.finding is None
    assert result.revision_count == 1
    assert investigator.revisions == [(initial, ("Clarify the observed behavior.",))]
    assert result.review == FailureReview(
        approved=False,
        feedback=("Evidence remains ambiguous.",),
    )


@pytest.mark.asyncio
async def test_product_defect_requires_the_same_failure_to_reproduce() -> None:
    workflow = FailureInvestigationWorkflow(
        reproducer=_ReproducerDouble(
            _attempt(
                passed=False,
                run="reproduction",
                actual="A different failure",
            )
        ),
        investigator=_InvestigatorDouble([_analysis()]),
        reviewer=_ReviewerDouble([FailureReview(approved=True, feedback=())]),
    )

    with pytest.raises(FailureInvestigationError, match="matching reproduction"):
        await workflow.run(_task())
