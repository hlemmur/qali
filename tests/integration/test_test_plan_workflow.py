from __future__ import annotations

import pytest

from app.test_design import TestDesignTask as DesignTask
from app.test_design import TestPlan as Plan
from app.test_plan_workflow import (
    PlanGateStatus,
    PlanReview,
    PlanReviewTask,
)
from app.test_plan_workflow import (
    TestPlanWorkflow as PlanWorkflow,
)
from tests.integration.test_plan_reviewer_agent import _review_task


class _DesignerDouble:
    def __init__(self, plans: list[Plan]) -> None:
        self._plans = iter(plans)
        self.design_tasks: list[DesignTask] = []
        self.revisions: list[tuple[Plan, tuple[str, ...]]] = []

    async def design(self, task: DesignTask) -> Plan:
        self.design_tasks.append(task)
        return next(self._plans)

    async def revise(
        self,
        task: DesignTask,
        prior: Plan,
        feedback: tuple[str, ...],
    ) -> Plan:
        assert task == self.design_tasks[0]
        self.revisions.append((prior, feedback))
        return next(self._plans)


class _ReviewerDouble:
    def __init__(self, reviews: list[PlanReview]) -> None:
        self._reviews = iter(reviews)
        self.tasks: list[PlanReviewTask] = []

    async def review(self, task: PlanReviewTask) -> PlanReview:
        self.tasks.append(task)
        return next(self._reviews)


@pytest.mark.asyncio
async def test_approved_test_plan_passes_without_revision() -> None:
    task = _review_task()
    designer = _DesignerDouble([task.plan])
    reviewer = _ReviewerDouble([PlanReview(approved=True, feedback=())])
    workflow = PlanWorkflow(designer=designer, reviewer=reviewer)

    result = await workflow.run(task.design_task)

    assert result.status is PlanGateStatus.APPROVED
    assert result.plan == task.plan
    assert result.revision_count == 0
    assert designer.revisions == []
    assert reviewer.tasks == [task]


@pytest.mark.asyncio
async def test_reviewer_can_request_exactly_one_plan_revision() -> None:
    task = _review_task()
    revised = task.plan.model_copy(
        update={
            "scenarios": (
                task.plan.scenarios[0].model_copy(
                    update={"title": "Save and verify a valid display name"}
                ),
            )
        }
    )
    feedback = ("Make the verification explicit.",)
    designer = _DesignerDouble([task.plan, revised])
    reviewer = _ReviewerDouble(
        [
            PlanReview(approved=False, feedback=feedback),
            PlanReview(approved=True, feedback=()),
        ]
    )
    workflow = PlanWorkflow(designer=designer, reviewer=reviewer)

    result = await workflow.run(task.design_task)

    assert result.status is PlanGateStatus.APPROVED
    assert result.plan == revised
    assert result.revision_count == 1
    assert designer.revisions == [(task.plan, feedback)]
    assert len(reviewer.tasks) == 2


@pytest.mark.asyncio
async def test_second_rejection_returns_an_explicit_escalated_result() -> None:
    task = _review_task()
    designer = _DesignerDouble([task.plan, task.plan])
    reviewer = _ReviewerDouble(
        [
            PlanReview(approved=False, feedback=("Strengthen the oracle.",)),
            PlanReview(approved=False, feedback=("Oracle is still ambiguous.",)),
        ]
    )
    workflow = PlanWorkflow(designer=designer, reviewer=reviewer)

    result = await workflow.run(task.design_task)

    assert result.status is PlanGateStatus.ESCALATED
    assert result.revision_count == 1
    assert result.review.feedback == ("Oracle is still ambiguous.",)
    assert len(designer.revisions) == 1
    assert len(reviewer.tasks) == 2
