from __future__ import annotations

from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.test_design import TestDesignTask, TestPlan, validate_test_plan


class PlanGateStatus(StrEnum):
    APPROVED = "approved"
    ESCALATED = "escalated"


class PlanReview(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    approved: bool
    feedback: tuple[str, ...] = Field(max_length=10)

    @model_validator(mode="after")
    def require_consistent_verdict(self) -> PlanReview:
        if not self.approved and not self.feedback:
            raise ValueError("rejected plan review requires feedback")
        if self.approved and self.feedback:
            raise ValueError("approved plan review cannot include feedback")
        if any(not item.strip() or len(item) > 1_000 for item in self.feedback):
            raise ValueError("plan review feedback is invalid")
        return self


class PlanReviewTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    design_task: TestDesignTask
    plan: TestPlan


class TestPlanWorkflowResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    plan: TestPlan
    review: PlanReview
    status: PlanGateStatus
    revision_count: int = Field(ge=0, le=1)


class TestDesigner(Protocol):
    async def design(self, task: TestDesignTask) -> TestPlan: ...

    async def revise(
        self,
        task: TestDesignTask,
        prior: TestPlan,
        feedback: tuple[str, ...],
    ) -> TestPlan: ...


class PlanReviewer(Protocol):
    async def review(self, task: PlanReviewTask) -> PlanReview: ...


class TestPlanWorkflow:
    def __init__(self, *, designer: TestDesigner, reviewer: PlanReviewer) -> None:
        self._designer = designer
        self._reviewer = reviewer

    async def run(self, task: TestDesignTask) -> TestPlanWorkflowResult:
        plan = validate_test_plan(await self._designer.design(task), task=task)
        review = await self._reviewer.review(
            PlanReviewTask(design_task=task, plan=plan)
        )
        revision_count = 0
        if not review.approved:
            plan = validate_test_plan(
                await self._designer.revise(task, plan, review.feedback),
                task=task,
            )
            revision_count = 1
            review = await self._reviewer.review(
                PlanReviewTask(design_task=task, plan=plan)
            )

        return TestPlanWorkflowResult(
            plan=plan,
            review=review,
            status=(
                PlanGateStatus.APPROVED if review.approved else PlanGateStatus.ESCALATED
            ),
            revision_count=revision_count,
        )


__all__ = [
    "PlanGateStatus",
    "PlanReview",
    "PlanReviewTask",
    "TestPlanWorkflow",
    "TestPlanWorkflowResult",
]
