from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.feature_planning_workflow import (
    FeaturePlanningStatus,
    FeaturePlanningWorkflowResult,
)
from app.feature_request_workflow import (
    FeatureRequestStatus,
    FeatureRequestTask,
    FeatureRequestWorkflow,
    FeatureRequestWorkflowError,
)
from app.feature_run_workflow import (
    FeatureRunTask,
    FeatureRunWorkflow,
    FeatureRunWorkflowResult,
)
from app.product_alignment import ProductAlignmentStatus
from app.run_artifact_repository import InMemoryRunArtifactRepository
from app.slack_feature_results import InMemorySlackFeatureResultPublisher
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_failure_investigation_workflow import _attempt
from tests.integration.test_feature_planning_workflow import _escalated_result
from tests.integration.test_feature_run_workflow import (
    _approved_plan,
    _FailureWorkflowDouble,
    _ScenarioRunnerDouble,
)
from tests.integration.test_plan_reviewer_agent import _review_task
from tests.integration.test_product_alignment_agent import _task as _alignment_task
from tests.integration.test_slack_feature_results import _message


class _PlanningWorkflowDouble:
    def __init__(self, result: FeaturePlanningWorkflowResult) -> None:
        self.result = result
        self.tasks = []

    async def run(self, task):
        self.tasks.append(task)
        return self.result


class _RunWorkflowDouble:
    def __init__(self, result: FeatureRunWorkflowResult) -> None:
        self.result = result
        self.tasks = []

    async def run(self, task):
        self.tasks.append(task)
        return self.result


def _approved_planning_result() -> FeaturePlanningWorkflowResult:
    approved = _approved_plan()
    design_task = _review_task().design_task
    return FeaturePlanningWorkflowResult(
        status=FeaturePlanningStatus.APPROVED,
        intent=design_task.product_intent,
        strategy=design_task.strategy,
        risk_assessment=design_task.risk_assessment,
        plan_result=approved,
    )


def _clarification_result() -> FeaturePlanningWorkflowResult:
    approved = _approved_planning_result()
    intent = approved.intent.model_copy(
        update={
            "ambiguities": ("Which result ordering is expected?",),
            "status": ProductAlignmentStatus.NEEDS_CLARIFICATION,
        }
    )
    return FeaturePlanningWorkflowResult(
        status=FeaturePlanningStatus.NEEDS_CLARIFICATION,
        intent=intent,
        strategy=None,
        risk_assessment=None,
        plan_result=None,
    )


def _escalated_planning_result() -> FeaturePlanningWorkflowResult:
    approved = _approved_planning_result()
    escalated = _escalated_result()
    return approved.model_copy(
        update={
            "status": FeaturePlanningStatus.ESCALATED,
            "plan_result": escalated,
        }
    )


async def _run_result(run_id: str, feature_slug: str) -> FeatureRunWorkflowResult:
    workflow = FeatureRunWorkflow(
        scenario_runner=_ScenarioRunnerDouble([_attempt(passed=True, run="initial")]),
        failure_workflow=_FailureWorkflowDouble(),
        artifacts=InMemoryRunArtifactRepository(),
        slack_results=InMemorySlackFeatureResultPublisher(),
    )
    return await workflow.run(
        FeatureRunTask(
            project_id="project-alpha",
            run_id=run_id,
            feature_slug=feature_slug,
            request_markdown=_alignment_task().request,
            approved_plan=_approved_plan(),
            target_policy=_execution_task().target_policy,
            progress_message=_message(),
            mock_mode=True,
        )
    )


def _request_task(*, run_id: str, feature_slug: str) -> FeatureRequestTask:
    return FeatureRequestTask(
        alignment_task=_alignment_task(),
        run_id=run_id,
        feature_slug=feature_slug,
        target_policy=_execution_task().target_policy,
        progress_message=_message(),
        mock_mode=True,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("run_id", "feature_slug"),
    (
        ("run-profile-request", "profile-editing"),
        ("run-catalog-request", "catalog-filtering"),
    ),
)
async def test_approved_planning_executes_unrelated_feature_requests(
    run_id: str,
    feature_slug: str,
) -> None:
    planning = _PlanningWorkflowDouble(_approved_planning_result())
    execution = _RunWorkflowDouble(await _run_result(run_id, feature_slug))
    workflow = FeatureRequestWorkflow(planning=planning, execution=execution)
    task = _request_task(run_id=run_id, feature_slug=feature_slug)

    result = await workflow.run(task)

    assert result.status is FeatureRequestStatus.COMPLETED
    assert result.planning == planning.result
    assert result.run_result == execution.result
    assert planning.tasks == [task.alignment_task]
    [run_task] = execution.tasks
    assert run_task.project_id == task.alignment_task.project_id
    assert run_task.run_id == run_id
    assert run_task.feature_slug == feature_slug
    assert run_task.request_markdown == task.alignment_task.request
    assert run_task.approved_plan == planning.result.plan_result
    assert run_task.target_policy == task.target_policy
    assert run_task.progress_message == task.progress_message
    assert run_task.mock_mode is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("planning_result", "expected_status"),
    (
        (_clarification_result(), FeatureRequestStatus.NEEDS_CLARIFICATION),
        (_escalated_planning_result(), FeatureRequestStatus.ESCALATED),
    ),
)
async def test_unapproved_planning_stops_before_browser_execution(
    planning_result: FeaturePlanningWorkflowResult,
    expected_status: FeatureRequestStatus,
) -> None:
    planning = _PlanningWorkflowDouble(planning_result)
    execution = _RunWorkflowDouble(
        await _run_result("run-never-executed", "profile-editing")
    )
    workflow = FeatureRequestWorkflow(planning=planning, execution=execution)

    result = await workflow.run(
        _request_task(run_id="run-gated-request", feature_slug="profile-editing")
    )

    assert result.status is expected_status
    assert result.planning == planning_result
    assert result.run_result is None
    assert execution.tasks == []


def test_request_scope_must_match_the_browser_policy() -> None:
    task = _request_task(run_id="run-scope", feature_slug="profile-editing")
    mismatched_policy = task.target_policy.model_copy(
        update={"project_id": "project-other"}
    )

    with pytest.raises(ValidationError, match="scopes must match"):
        FeatureRequestTask(
            alignment_task=task.alignment_task,
            run_id=task.run_id,
            feature_slug=task.feature_slug,
            target_policy=mismatched_policy,
            progress_message=task.progress_message,
            mock_mode=task.mock_mode,
        )


def test_request_rejects_an_unsafe_run_identifier() -> None:
    task = _request_task(run_id="run-scope", feature_slug="profile-editing")

    with pytest.raises(ValidationError, match="string_pattern_mismatch"):
        FeatureRequestTask(
            alignment_task=task.alignment_task,
            run_id="Run/unsafe",
            feature_slug=task.feature_slug,
            target_policy=task.target_policy,
            progress_message=task.progress_message,
            mock_mode=task.mock_mode,
        )


@pytest.mark.asyncio
async def test_mismatched_execution_result_fails_closed() -> None:
    planning = _PlanningWorkflowDouble(_approved_planning_result())
    execution = _RunWorkflowDouble(await _run_result("run-other", "profile-editing"))
    workflow = FeatureRequestWorkflow(planning=planning, execution=execution)

    with pytest.raises(FeatureRequestWorkflowError, match="does not match"):
        await workflow.run(
            _request_task(
                run_id="run-expected",
                feature_slug="profile-editing",
            )
        )
