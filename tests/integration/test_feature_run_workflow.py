from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.feature_run_workflow import (
    FeatureRunTask,
    FeatureRunWorkflow,
    FeatureRunWorkflowError,
)
from app.run_artifact_repository import InMemoryRunArtifactRepository
from app.slack_feature_results import InMemorySlackFeatureResultPublisher
from app.test_plan_workflow import PlanGateStatus, PlanReview
from app.test_plan_workflow import TestPlanWorkflowResult as ApprovedPlanResult
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_failure_investigation_workflow import _attempt
from tests.integration.test_plan_reviewer_agent import _review_task
from tests.integration.test_run_artifacts import _failed_run
from tests.integration.test_slack_feature_results import _message


class _ScenarioRunnerDouble:
    def __init__(self, attempts):
        self._attempts = iter(attempts)
        self.tasks = []

    async def execute(self, task):
        self.tasks.append(task)
        return next(self._attempts)


class _FailureWorkflowDouble:
    def __init__(self, results=()) -> None:
        self._results = iter(results)
        self.tasks = []

    async def run(self, task):
        self.tasks.append(task)
        return next(self._results)


class _FailingArtifactPublisher:
    async def publish(self, bundle):
        del bundle
        raise RuntimeError("artifact persistence unavailable")


def _approved_plan() -> ApprovedPlanResult:
    return ApprovedPlanResult(
        plan=_review_task().plan,
        review=PlanReview(approved=True, feedback=()),
        status=PlanGateStatus.APPROVED,
        revision_count=0,
    )


@pytest.mark.asyncio
async def test_approved_feature_run_persists_before_publishing_mock_result() -> None:
    runner = _ScenarioRunnerDouble([_attempt(passed=True, run="initial")])
    investigator = _FailureWorkflowDouble()
    artifacts = InMemoryRunArtifactRepository(
        clock=lambda: datetime(2026, 9, 8, 11, 0, tzinfo=UTC)
    )
    slack = InMemorySlackFeatureResultPublisher()
    workflow = FeatureRunWorkflow(
        scenario_runner=runner,
        failure_workflow=investigator,
        artifacts=artifacts,
        slack_results=slack,
    )
    task = FeatureRunTask(
        project_id="project-alpha",
        run_id="run-profile-workflow",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        approved_plan=_approved_plan(),
        target_policy=_execution_task().target_policy,
        progress_message=_message(),
        mock_mode=True,
    )

    result = await workflow.run(task)

    assert result.record.scenario_results[0].evaluation.passed is True
    assert result.record.investigations == ()
    assert len(result.published_artifacts.artifacts) == 4
    assert result.slack_result.text == (
        "[MOCK MODE]\nProfile display-name editing: 1 scenario passed (2 checks)."
    )
    assert slack.list_messages() == [(task.progress_message, result.slack_result)]
    assert len(runner.tasks) == 1
    assert runner.tasks[0].scenario == task.approved_plan.plan.scenarios[0]
    assert investigator.tasks == []


@pytest.mark.asyncio
async def test_failed_feature_run_is_investigated_and_publishes_reviewed_finding() -> (
    None
):
    failed_record = await _failed_run()
    investigation = failed_record.investigations[0]
    runner = _ScenarioRunnerDouble([_attempt(passed=False, run="initial")])
    investigator = _FailureWorkflowDouble([investigation])
    artifacts = InMemoryRunArtifactRepository()
    slack = InMemorySlackFeatureResultPublisher()
    workflow = FeatureRunWorkflow(
        scenario_runner=runner,
        failure_workflow=investigator,
        artifacts=artifacts,
        slack_results=slack,
    )
    task = FeatureRunTask(
        project_id="project-alpha",
        run_id="run-profile-failure",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        approved_plan=_approved_plan(),
        target_policy=_execution_task().target_policy,
        progress_message=_message(),
        mock_mode=False,
    )

    result = await workflow.run(task)

    finding = result.record.investigations[0].finding
    assert finding is not None
    assert len(result.published_artifacts.artifacts) == 5
    assert finding.finding_id in result.slack_result.text
    assert (
        investigator.tasks[0].initial_attempt.result
        == (result.record.scenario_results[0])
    )


@pytest.mark.asyncio
async def test_feature_run_retry_reuses_artifacts_and_replaces_slack_result() -> None:
    attempt = _attempt(passed=True, run="initial")
    runner = _ScenarioRunnerDouble([attempt, attempt])
    artifacts = InMemoryRunArtifactRepository(
        clock=lambda: datetime(2026, 9, 8, 11, 5, tzinfo=UTC)
    )
    slack = InMemorySlackFeatureResultPublisher()
    workflow = FeatureRunWorkflow(
        scenario_runner=runner,
        failure_workflow=_FailureWorkflowDouble(),
        artifacts=artifacts,
        slack_results=slack,
    )
    task = FeatureRunTask(
        project_id="project-alpha",
        run_id="run-profile-retry",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        approved_plan=_approved_plan(),
        target_policy=_execution_task().target_policy,
        progress_message=_message(),
        mock_mode=True,
    )

    first = await workflow.run(task)
    retry = await workflow.run(task)

    assert retry == first
    assert slack.list_messages() == [(task.progress_message, first.slack_result)]
    for pointer in first.published_artifacts.artifacts:
        assert (await artifacts.read(pointer.object_name)).sha256 == pointer.sha256


@pytest.mark.asyncio
async def test_untrusted_scenario_result_cannot_be_persisted_or_published() -> None:
    attempt = _attempt(passed=True, run="initial")
    substituted = attempt.model_copy(
        update={
            "result": attempt.result.model_copy(
                update={"scenario_id": "other-scenario"}
            )
        }
    )
    slack = InMemorySlackFeatureResultPublisher()
    workflow = FeatureRunWorkflow(
        scenario_runner=_ScenarioRunnerDouble([substituted]),
        failure_workflow=_FailureWorkflowDouble(),
        artifacts=InMemoryRunArtifactRepository(),
        slack_results=slack,
    )
    task = FeatureRunTask(
        project_id="project-alpha",
        run_id="run-profile-substituted",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        approved_plan=_approved_plan(),
        target_policy=_execution_task().target_policy,
        progress_message=_message(),
        mock_mode=True,
    )

    with pytest.raises(FeatureRunWorkflowError, match="different scenario"):
        await workflow.run(task)

    assert slack.list_messages() == []


@pytest.mark.asyncio
async def test_artifact_failure_prevents_a_success_message() -> None:
    slack = InMemorySlackFeatureResultPublisher()
    workflow = FeatureRunWorkflow(
        scenario_runner=_ScenarioRunnerDouble([_attempt(passed=True, run="initial")]),
        failure_workflow=_FailureWorkflowDouble(),
        artifacts=_FailingArtifactPublisher(),
        slack_results=slack,
    )
    task = FeatureRunTask(
        project_id="project-alpha",
        run_id="run-profile-storage-failure",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        approved_plan=_approved_plan(),
        target_policy=_execution_task().target_policy,
        progress_message=_message(),
        mock_mode=True,
    )

    with pytest.raises(RuntimeError, match="persistence unavailable"):
        await workflow.run(task)

    assert slack.list_messages() == []
