from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.feature_planning import (
    CoverageConcern,
    CoverageDisposition,
    RiskAssessment,
    TestStrategy,
)
from app.product_alignment import ProductAlignmentStatus, ProductIntent


class OracleKind(StrEnum):
    URL = "url"
    ACCESSIBILITY_TEXT = "accessibility_text"
    ELEMENT_COUNT = "element_count"
    CONSOLE_ERRORS = "console_errors"
    NETWORK_ERRORS = "network_errors"


class OracleOperator(StrEnum):
    EQUALS = "equals"
    CONTAINS = "contains"
    ABSENT = "absent"
    AT_LEAST = "at_least"
    AT_MOST = "at_most"


class EvidencePolicy(StrEnum):
    FAILURE_ONLY = "failure_only"
    ALWAYS = "always"


class Oracle(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    oracle_id: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    kind: OracleKind
    subject: str = Field(min_length=1, max_length=500)
    operator: OracleOperator
    expected: str | int | bool | None

    @model_validator(mode="after")
    def require_operator_value_consistency(self) -> Oracle:
        if self.operator is OracleOperator.ABSENT and self.expected is not None:
            raise ValueError("absence oracle cannot declare an expected value")
        if self.operator is not OracleOperator.ABSENT and self.expected is None:
            raise ValueError("value oracle requires an expected value")
        return self


class TestScenario(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    scenario_id: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    title: str = Field(min_length=1, max_length=300)
    trace_refs: tuple[str, ...] = Field(min_length=1, max_length=50)
    coverage: tuple[CoverageConcern, ...] = Field(min_length=1, max_length=20)
    setup: tuple[str, ...] = Field(max_length=50)
    user_intent: str = Field(min_length=1, max_length=2_000)
    step_budget: int = Field(gt=0, le=50)
    positive_oracles: tuple[Oracle, ...] = Field(min_length=1, max_length=20)
    forbidden_state_oracles: tuple[Oracle, ...] = Field(
        min_length=1,
        max_length=20,
    )
    cleanup: tuple[str, ...] = Field(max_length=50)
    evidence_policy: EvidencePolicy


class TestPlan(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    feature_name: str = Field(min_length=1, max_length=200)
    scenarios: tuple[TestScenario, ...] = Field(min_length=1, max_length=100)

    @field_validator("scenarios")
    @classmethod
    def require_distinct_ids(
        cls,
        value: tuple[TestScenario, ...],
    ) -> tuple[TestScenario, ...]:
        scenario_ids = [scenario.scenario_id for scenario in value]
        if len(scenario_ids) != len(set(scenario_ids)):
            raise ValueError("scenario IDs must be distinct")
        oracle_ids = [
            oracle.oracle_id
            for scenario in value
            for oracle in (
                *scenario.positive_oracles,
                *scenario.forbidden_state_oracles,
            )
        ]
        if len(oracle_ids) != len(set(oracle_ids)):
            raise ValueError("oracle IDs must be distinct")
        return value


class TestDesignTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    product_intent: ProductIntent
    strategy: TestStrategy
    risk_assessment: RiskAssessment

    @model_validator(mode="after")
    def require_matching_approved_inputs(self) -> TestDesignTask:
        intent = self.product_intent
        scopes = {
            (intent.project_id, intent.feature_name),
            (self.strategy.project_id, self.strategy.feature_name),
            (
                self.risk_assessment.project_id,
                self.risk_assessment.feature_name,
            ),
        }
        if intent.status is not ProductAlignmentStatus.READY or len(scopes) != 1:
            raise ValueError("test design requires matching approved planning inputs")
        return self


class TestPlanValidationError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"test plan is invalid: {reason}")


def validate_test_plan(plan: TestPlan, *, task: TestDesignTask) -> TestPlan:
    intent = task.product_intent
    if plan.project_id != intent.project_id or plan.feature_name != intent.feature_name:
        raise TestPlanValidationError("scope does not match approved intent")

    approved_trace_refs = {
        "product:user_value",
        *(
            f"product:expected_behavior:{index}"
            for index, _ in enumerate(intent.expected_behaviors)
        ),
        *(
            f"product:prerequisite:{index}"
            for index, _ in enumerate(intent.prerequisites)
        ),
        *(f"product:scope:{index}" for index, _ in enumerate(intent.in_scope)),
        *(
            f"risk:{risk.risk_id}"
            for assessment in task.risk_assessment.areas
            for risk in assessment.risks
        ),
    }
    if any(
        trace_ref not in approved_trace_refs
        for scenario in plan.scenarios
        for trace_ref in scenario.trace_refs
    ):
        raise TestPlanValidationError("scenario has an unsupported trace reference")

    required_coverage = {
        decision.concern
        for decision in task.strategy.coverage
        if decision.disposition is CoverageDisposition.COVER
    }
    declared_coverage = {
        concern for scenario in plan.scenarios for concern in scenario.coverage
    }
    if declared_coverage != required_coverage:
        raise TestPlanValidationError(
            "scenario coverage does not match the approved strategy"
        )
    return plan


__all__ = [
    "EvidencePolicy",
    "Oracle",
    "OracleKind",
    "OracleOperator",
    "TestDesignTask",
    "TestPlan",
    "TestPlanValidationError",
    "TestScenario",
    "validate_test_plan",
]
