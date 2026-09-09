from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.browser_executor_agent import BrowserExecutionTask
from app.browser_policy import BrowserTargetPolicy
from app.failure_investigation import (
    FailureAttempt,
    FailureInvestigationResult,
    FailureInvestigationTask,
)
from app.project_projection_repository import PublishedProjectProjections
from app.run_artifact_repository import PublishedRunArtifacts
from app.run_artifacts import (
    FeatureRunArtifactBundle,
    FeatureRunRecord,
    compile_feature_run_artifacts,
)
from app.slack_feature_results import SlackFeatureResult, render_feature_result
from app.slack_progress import ProgressMessage
from app.test_plan_workflow import PlanGateStatus, TestPlanWorkflowResult


class FeatureRunTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    run_id: str = Field(min_length=1, max_length=128)
    feature_slug: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    request_markdown: str = Field(min_length=1, max_length=20_000)
    approved_plan: TestPlanWorkflowResult
    target_policy: BrowserTargetPolicy
    progress_message: ProgressMessage
    mock_mode: bool

    @model_validator(mode="after")
    def require_approved_matching_scope(self) -> FeatureRunTask:
        if (
            self.approved_plan.status is not PlanGateStatus.APPROVED
            or not self.approved_plan.review.approved
        ):
            raise ValueError("feature execution requires an approved test plan")
        if (
            self.approved_plan.plan.project_id != self.project_id
            or self.target_policy.project_id != self.project_id
        ):
            raise ValueError("feature execution scopes must match the project")
        for scenario in self.approved_plan.plan.scenarios:
            BrowserExecutionTask(
                project_id=self.project_id,
                run_id=self.run_id,
                scenario=scenario,
                target_policy=self.target_policy,
            )
        return self


class FeatureRunWorkflowResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    record: FeatureRunRecord
    published_artifacts: PublishedRunArtifacts
    published_projections: PublishedProjectProjections | None = None
    slack_result: SlackFeatureResult


class ScenarioRunner(Protocol):
    async def execute(self, task: BrowserExecutionTask) -> FailureAttempt: ...


class FailureWorkflow(Protocol):
    async def run(
        self,
        task: FailureInvestigationTask,
    ) -> FailureInvestigationResult: ...


class RunArtifactPublisher(Protocol):
    async def publish(
        self,
        bundle: FeatureRunArtifactBundle,
    ) -> PublishedRunArtifacts: ...


class SlackResultPublisher(Protocol):
    async def publish(
        self,
        message: ProgressMessage,
        result: SlackFeatureResult,
    ) -> None: ...


class ProjectProjectionPublisher(Protocol):
    async def refresh(self, project_id: str) -> PublishedProjectProjections: ...


class FeatureRunWorkflowError(RuntimeError):
    pass


class FeatureRunWorkflow:
    def __init__(
        self,
        *,
        scenario_runner: ScenarioRunner,
        failure_workflow: FailureWorkflow,
        artifacts: RunArtifactPublisher,
        slack_results: SlackResultPublisher,
        project_projections: ProjectProjectionPublisher | None = None,
    ) -> None:
        self._scenario_runner = scenario_runner
        self._failure_workflow = failure_workflow
        self._artifacts = artifacts
        self._slack_results = slack_results
        self._project_projections = project_projections

    async def run(self, task: FeatureRunTask) -> FeatureRunWorkflowResult:
        scenario_results = []
        investigations = []
        for scenario in task.approved_plan.plan.scenarios:
            execution_task = BrowserExecutionTask(
                project_id=task.project_id,
                run_id=task.run_id,
                scenario=scenario,
                target_policy=task.target_policy,
            )
            attempt = await self._scenario_runner.execute(execution_task)
            if attempt.result.scenario_id != scenario.scenario_id:
                raise FeatureRunWorkflowError(
                    "scenario runner returned a result for a different scenario"
                )
            scenario_results.append(attempt.result)
            if not attempt.result.evaluation.passed:
                investigations.append(
                    await self._failure_workflow.run(
                        FailureInvestigationTask(
                            project_id=task.project_id,
                            feature_slug=task.feature_slug,
                            execution_task=execution_task,
                            initial_attempt=attempt,
                        )
                    )
                )

        record = FeatureRunRecord(
            project_id=task.project_id,
            run_id=task.run_id,
            feature_slug=task.feature_slug,
            request_markdown=task.request_markdown,
            plan=task.approved_plan.plan,
            scenario_results=tuple(scenario_results),
            investigations=tuple(investigations),
        )
        published_artifacts = await self._artifacts.publish(
            compile_feature_run_artifacts(record)
        )
        published_projections = (
            None
            if self._project_projections is None
            else await self._project_projections.refresh(task.project_id)
        )
        slack_result = render_feature_result(record, mock_mode=task.mock_mode)
        await self._slack_results.publish(task.progress_message, slack_result)
        return FeatureRunWorkflowResult(
            record=record,
            published_artifacts=published_artifacts,
            published_projections=published_projections,
            slack_result=slack_result,
        )


__all__ = [
    "FeatureRunTask",
    "FeatureRunWorkflow",
    "FeatureRunWorkflowError",
    "FeatureRunWorkflowResult",
    "ProjectProjectionPublisher",
]
