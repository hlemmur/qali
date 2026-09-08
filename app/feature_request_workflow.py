from __future__ import annotations

from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.browser_policy import BrowserTargetPolicy
from app.feature_planning_workflow import (
    FeaturePlanningStatus,
    FeaturePlanningWorkflowResult,
)
from app.feature_run_workflow import (
    FeatureRunTask,
    FeatureRunWorkflowResult,
)
from app.product_alignment import ProductAlignmentTask
from app.slack_progress import ProgressMessage


class FeatureRequestStatus(StrEnum):
    COMPLETED = "completed"
    NEEDS_CLARIFICATION = "needs_clarification"
    ESCALATED = "escalated"


class FeatureRequestTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    alignment_task: ProductAlignmentTask
    run_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    feature_slug: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    target_policy: BrowserTargetPolicy
    progress_message: ProgressMessage
    mock_mode: bool

    @model_validator(mode="after")
    def require_matching_scope(self) -> FeatureRequestTask:
        if self.alignment_task.project_id != self.target_policy.project_id:
            raise ValueError("feature request scopes must match the project")
        return self


class FeatureRequestWorkflowResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    status: FeatureRequestStatus
    planning: FeaturePlanningWorkflowResult
    run_result: FeatureRunWorkflowResult | None

    @model_validator(mode="after")
    def require_status_payload(self) -> FeatureRequestWorkflowResult:
        expected = {
            FeaturePlanningStatus.APPROVED: FeatureRequestStatus.COMPLETED,
            FeaturePlanningStatus.NEEDS_CLARIFICATION: (
                FeatureRequestStatus.NEEDS_CLARIFICATION
            ),
            FeaturePlanningStatus.ESCALATED: FeatureRequestStatus.ESCALATED,
        }[self.planning.status]
        if self.status is not expected:
            raise ValueError("feature request status does not match planning")
        if (self.run_result is not None) != (
            self.status is FeatureRequestStatus.COMPLETED
        ):
            raise ValueError("only completed feature requests contain a run result")
        return self


class PlanningWorkflow(Protocol):
    async def run(
        self,
        task: ProductAlignmentTask,
    ) -> FeaturePlanningWorkflowResult: ...


class ExecutionWorkflow(Protocol):
    async def run(self, task: FeatureRunTask) -> FeatureRunWorkflowResult: ...


class FeatureRequestWorkflowError(RuntimeError):
    pass


class FeatureRequestWorkflow:
    def __init__(
        self,
        *,
        planning: PlanningWorkflow,
        execution: ExecutionWorkflow,
    ) -> None:
        self._planning = planning
        self._execution = execution

    async def run(self, task: FeatureRequestTask) -> FeatureRequestWorkflowResult:
        planning = await self._planning.run(task.alignment_task)
        if planning.status is not FeaturePlanningStatus.APPROVED:
            return FeatureRequestWorkflowResult(
                status=(
                    FeatureRequestStatus.NEEDS_CLARIFICATION
                    if planning.status is FeaturePlanningStatus.NEEDS_CLARIFICATION
                    else FeatureRequestStatus.ESCALATED
                ),
                planning=planning,
                run_result=None,
            )

        if planning.plan_result is None:
            raise FeatureRequestWorkflowError(
                "approved planning result does not contain a plan"
            )
        run_result = await self._execution.run(
            FeatureRunTask(
                project_id=task.alignment_task.project_id,
                run_id=task.run_id,
                feature_slug=task.feature_slug,
                request_markdown=task.alignment_task.request,
                approved_plan=planning.plan_result,
                target_policy=task.target_policy,
                progress_message=task.progress_message,
                mock_mode=task.mock_mode,
            )
        )
        record = run_result.record
        if (
            record.project_id != task.alignment_task.project_id
            or record.run_id != task.run_id
            or record.feature_slug != task.feature_slug
            or record.request_markdown != task.alignment_task.request
            or record.plan != planning.plan_result.plan
        ):
            raise FeatureRequestWorkflowError(
                "feature execution result does not match the approved request"
            )
        return FeatureRequestWorkflowResult(
            status=FeatureRequestStatus.COMPLETED,
            planning=planning,
            run_result=run_result,
        )


__all__ = [
    "FeatureRequestStatus",
    "FeatureRequestTask",
    "FeatureRequestWorkflow",
    "FeatureRequestWorkflowError",
    "FeatureRequestWorkflowResult",
]
