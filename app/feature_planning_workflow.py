from __future__ import annotations

import asyncio
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, model_validator

from app.feature_planning import (
    RiskAssessment,
    RiskTask,
    StrategyTask,
    TestStrategy,
    validate_risk_assessment,
    validate_strategy,
)
from app.product_alignment import (
    ProductAlignmentStatus,
    ProductAlignmentTask,
    ProductIntent,
    validate_product_intent,
)
from app.test_design import TestDesignTask, validate_test_plan
from app.test_plan_workflow import PlanGateStatus, TestPlanWorkflowResult


class FeaturePlanningStatus(StrEnum):
    APPROVED = "approved"
    NEEDS_CLARIFICATION = "needs_clarification"
    ESCALATED = "escalated"


class FeaturePlanningWorkflowResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    status: FeaturePlanningStatus
    intent: ProductIntent
    strategy: TestStrategy | None
    risk_assessment: RiskAssessment | None
    plan_result: TestPlanWorkflowResult | None

    @model_validator(mode="after")
    def require_status_payload(self) -> FeaturePlanningWorkflowResult:
        downstream = (self.strategy, self.risk_assessment, self.plan_result)
        if self.status is FeaturePlanningStatus.NEEDS_CLARIFICATION:
            if (
                self.intent.status is not ProductAlignmentStatus.NEEDS_CLARIFICATION
                or any(item is not None for item in downstream)
            ):
                raise ValueError("clarification result cannot contain downstream plans")
            return self
        if self.intent.status is not ProductAlignmentStatus.READY or any(
            item is None for item in downstream
        ):
            raise ValueError("planned result requires complete approved inputs")
        assert self.plan_result is not None
        expected_status = (
            FeaturePlanningStatus.APPROVED
            if self.plan_result.status is PlanGateStatus.APPROVED
            else FeaturePlanningStatus.ESCALATED
        )
        if self.status is not expected_status:
            raise ValueError("planning status does not match the plan review gate")
        return self


class ProductAlignmentAnalyst(Protocol):
    async def align(self, task: ProductAlignmentTask) -> ProductIntent: ...


class QaStrategist(Protocol):
    async def plan(self, task: StrategyTask) -> TestStrategy: ...


class RiskAnalyst(Protocol):
    async def assess(self, task: RiskTask) -> RiskAssessment: ...


class ReviewedPlanWorkflow(Protocol):
    async def run(self, task: TestDesignTask) -> TestPlanWorkflowResult: ...


class FeaturePlanningWorkflowError(RuntimeError):
    pass


class FeaturePlanningWorkflow:
    def __init__(
        self,
        *,
        alignment: ProductAlignmentAnalyst,
        strategist: QaStrategist,
        risk_analyst: RiskAnalyst,
        plan_workflow: ReviewedPlanWorkflow,
    ) -> None:
        self._alignment = alignment
        self._strategist = strategist
        self._risk_analyst = risk_analyst
        self._plan_workflow = plan_workflow

    async def run(
        self,
        task: ProductAlignmentTask,
    ) -> FeaturePlanningWorkflowResult:
        intent = validate_product_intent(await self._alignment.align(task), task=task)
        if intent.status is ProductAlignmentStatus.NEEDS_CLARIFICATION:
            return FeaturePlanningWorkflowResult(
                status=FeaturePlanningStatus.NEEDS_CLARIFICATION,
                intent=intent,
                strategy=None,
                risk_assessment=None,
                plan_result=None,
            )

        strategy_task = StrategyTask(product_intent=intent)
        risk_task = RiskTask(product_intent=intent)
        strategy_output, risk_output = await asyncio.gather(
            self._strategist.plan(strategy_task),
            self._risk_analyst.assess(risk_task),
        )
        strategy = validate_strategy(strategy_output, task=strategy_task)
        risk_assessment = validate_risk_assessment(risk_output, task=risk_task)
        design_task = TestDesignTask(
            product_intent=intent,
            strategy=strategy,
            risk_assessment=risk_assessment,
        )
        plan_result = await self._plan_workflow.run(design_task)
        validate_test_plan(plan_result.plan, task=design_task)
        if plan_result.review.approved != (
            plan_result.status is PlanGateStatus.APPROVED
        ):
            raise FeaturePlanningWorkflowError(
                "plan review status does not match its verdict"
            )
        return FeaturePlanningWorkflowResult(
            status=(
                FeaturePlanningStatus.APPROVED
                if plan_result.status is PlanGateStatus.APPROVED
                else FeaturePlanningStatus.ESCALATED
            ),
            intent=intent,
            strategy=strategy,
            risk_assessment=risk_assessment,
            plan_result=plan_result,
        )


__all__ = [
    "FeaturePlanningStatus",
    "FeaturePlanningWorkflow",
    "FeaturePlanningWorkflowError",
    "FeaturePlanningWorkflowResult",
]
