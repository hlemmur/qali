from __future__ import annotations

import pytest

from app.feature_planning_workflow import (
    FeaturePlanningStatus,
    FeaturePlanningWorkflow,
    FeaturePlanningWorkflowError,
)
from app.product_alignment import ProductAlignmentStatus
from app.test_plan_workflow import PlanGateStatus, PlanReview
from app.test_plan_workflow import TestPlanWorkflowResult as ReviewedPlanResult
from tests.integration.test_plan_reviewer_agent import _review_task
from tests.integration.test_product_alignment_agent import _task


class _AlignmentDouble:
    def __init__(self, intent) -> None:
        self.intent = intent
        self.tasks = []

    async def align(self, task):
        self.tasks.append(task)
        return self.intent


class _StrategyDouble:
    def __init__(self, strategy) -> None:
        self.strategy = strategy
        self.tasks = []

    async def plan(self, task):
        self.tasks.append(task)
        return self.strategy


class _RiskDouble:
    def __init__(self, assessment) -> None:
        self.assessment = assessment
        self.tasks = []

    async def assess(self, task):
        self.tasks.append(task)
        return self.assessment


class _PlanWorkflowDouble:
    def __init__(self, result) -> None:
        self.result = result
        self.tasks = []

    async def run(self, task):
        self.tasks.append(task)
        return self.result


def _approved_result() -> ReviewedPlanResult:
    return ReviewedPlanResult(
        plan=_review_task().plan,
        review=PlanReview(approved=True, feedback=()),
        status=PlanGateStatus.APPROVED,
        revision_count=0,
    )


def _escalated_result() -> ReviewedPlanResult:
    return ReviewedPlanResult(
        plan=_review_task().plan,
        review=PlanReview(
            approved=False,
            feedback=("The deterministic oracle remains ambiguous.",),
        ),
        status=PlanGateStatus.ESCALATED,
        revision_count=1,
    )


@pytest.mark.asyncio
async def test_ready_intent_fans_out_and_enters_the_reviewed_plan_gate() -> None:
    review_task = _review_task()
    aligner = _AlignmentDouble(review_task.design_task.product_intent)
    strategist = _StrategyDouble(review_task.design_task.strategy)
    risk_analyst = _RiskDouble(review_task.design_task.risk_assessment)
    plan_workflow = _PlanWorkflowDouble(_approved_result())
    workflow = FeaturePlanningWorkflow(
        alignment=aligner,
        strategist=strategist,
        risk_analyst=risk_analyst,
        plan_workflow=plan_workflow,
    )

    result = await workflow.run(_task())

    assert result.status is FeaturePlanningStatus.APPROVED
    assert result.intent == review_task.design_task.product_intent
    assert result.strategy == review_task.design_task.strategy
    assert result.risk_assessment == review_task.design_task.risk_assessment
    assert result.plan_result == _approved_result()
    assert strategist.tasks[0].product_intent == result.intent
    assert risk_analyst.tasks[0].product_intent == result.intent
    assert plan_workflow.tasks == [review_task.design_task]


@pytest.mark.asyncio
async def test_ambiguous_intent_requests_clarification_before_planning() -> None:
    review_task = _review_task()
    ambiguous = review_task.design_task.product_intent.model_copy(
        update={
            "ambiguities": ("Which profile name format is accepted?",),
            "status": ProductAlignmentStatus.NEEDS_CLARIFICATION,
        }
    )
    strategist = _StrategyDouble(review_task.design_task.strategy)
    risk_analyst = _RiskDouble(review_task.design_task.risk_assessment)
    plan_workflow = _PlanWorkflowDouble(_approved_result())
    workflow = FeaturePlanningWorkflow(
        alignment=_AlignmentDouble(ambiguous),
        strategist=strategist,
        risk_analyst=risk_analyst,
        plan_workflow=plan_workflow,
    )

    result = await workflow.run(_task())

    assert result.status is FeaturePlanningStatus.NEEDS_CLARIFICATION
    assert result.intent == ambiguous
    assert result.strategy is None
    assert result.risk_assessment is None
    assert result.plan_result is None
    assert strategist.tasks == []
    assert risk_analyst.tasks == []
    assert plan_workflow.tasks == []


@pytest.mark.asyncio
async def test_second_plan_rejection_stays_explicitly_escalated() -> None:
    review_task = _review_task()
    workflow = FeaturePlanningWorkflow(
        alignment=_AlignmentDouble(review_task.design_task.product_intent),
        strategist=_StrategyDouble(review_task.design_task.strategy),
        risk_analyst=_RiskDouble(review_task.design_task.risk_assessment),
        plan_workflow=_PlanWorkflowDouble(_escalated_result()),
    )

    result = await workflow.run(_task())

    assert result.status is FeaturePlanningStatus.ESCALATED
    assert result.plan_result == _escalated_result()
    assert result.plan_result.review.feedback == (
        "The deterministic oracle remains ambiguous.",
    )


@pytest.mark.asyncio
async def test_inconsistent_plan_gate_output_fails_closed() -> None:
    review_task = _review_task()
    inconsistent = _escalated_result().model_copy(
        update={"status": PlanGateStatus.APPROVED}
    )
    workflow = FeaturePlanningWorkflow(
        alignment=_AlignmentDouble(review_task.design_task.product_intent),
        strategist=_StrategyDouble(review_task.design_task.strategy),
        risk_analyst=_RiskDouble(review_task.design_task.risk_assessment),
        plan_workflow=_PlanWorkflowDouble(inconsistent),
    )

    with pytest.raises(FeaturePlanningWorkflowError, match="does not match"):
        await workflow.run(_task())
