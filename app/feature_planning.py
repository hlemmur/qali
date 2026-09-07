from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.product_alignment import ProductAlignmentStatus, ProductIntent


class CoverageConcern(StrEnum):
    NOMINAL = "nominal"
    BOUNDARY = "boundary"
    NEGATIVE_ERROR = "negative_error"
    STATE_TRANSITION = "state_transition"
    REPEATED_IDEMPOTENT = "repeated_idempotent"
    RAPID_ACTION = "rapid_action"
    MULTI_CONTEXT_CONCURRENCY = "multi_context_concurrency"
    ACCESSIBILITY_TREE = "accessibility_tree"
    ENVIRONMENT = "environment"


REQUIRED_COVERAGE_CONCERNS: tuple[CoverageConcern, ...] = (
    CoverageConcern.NOMINAL,
    CoverageConcern.BOUNDARY,
    CoverageConcern.NEGATIVE_ERROR,
    CoverageConcern.STATE_TRANSITION,
    CoverageConcern.REPEATED_IDEMPOTENT,
    CoverageConcern.RAPID_ACTION,
    CoverageConcern.MULTI_CONTEXT_CONCURRENCY,
    CoverageConcern.ACCESSIBILITY_TREE,
    CoverageConcern.ENVIRONMENT,
)


class CoverageDisposition(StrEnum):
    COVER = "cover"
    NOT_APPLICABLE = "not_applicable"


class CoverageDecision(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    concern: CoverageConcern
    disposition: CoverageDisposition
    rationale: str = Field(min_length=1, max_length=2_000)


class TestStrategy(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    feature_name: str = Field(min_length=1, max_length=200)
    mission: str = Field(min_length=1, max_length=2_000)
    coverage: tuple[CoverageDecision, ...] = Field(max_length=20)
    assumptions: tuple[str, ...] = Field(max_length=50)
    stopping_conditions: tuple[str, ...] = Field(min_length=1, max_length=20)

    @field_validator("coverage")
    @classmethod
    def require_complete_coverage(
        cls,
        value: tuple[CoverageDecision, ...],
    ) -> tuple[CoverageDecision, ...]:
        concerns = [decision.concern for decision in value]
        if len(concerns) != len(REQUIRED_COVERAGE_CONCERNS) or set(concerns) != set(
            REQUIRED_COVERAGE_CONCERNS
        ):
            raise ValueError("strategy must cover every coverage concern exactly once")
        return value


class StrategyTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    product_intent: ProductIntent

    @model_validator(mode="after")
    def require_approved_intent(self) -> StrategyTask:
        if self.product_intent.status is not ProductAlignmentStatus.READY:
            raise ValueError("strategy requires a ready product intent")
        return self


class RiskArea(StrEnum):
    PRODUCT = "product"
    STATE = "state"
    DATA = "data"
    ENVIRONMENT = "environment"
    CONCURRENCY = "concurrency"
    USABILITY = "usability"


REQUIRED_RISK_AREAS: tuple[RiskArea, ...] = (
    RiskArea.PRODUCT,
    RiskArea.STATE,
    RiskArea.DATA,
    RiskArea.ENVIRONMENT,
    RiskArea.CONCURRENCY,
    RiskArea.USABILITY,
)


class RiskDisposition(StrEnum):
    IDENTIFIED = "identified"
    NOT_APPLICABLE = "not_applicable"


class RiskPriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RiskItem(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    risk_id: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    area: RiskArea
    description: str = Field(min_length=1, max_length=2_000)
    priority: RiskPriority


class RiskAreaAssessment(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    area: RiskArea
    disposition: RiskDisposition
    rationale: str = Field(min_length=1, max_length=2_000)
    risks: tuple[RiskItem, ...] = Field(max_length=50)

    @model_validator(mode="after")
    def require_concrete_identified_risk(self) -> RiskAreaAssessment:
        if self.disposition is RiskDisposition.IDENTIFIED and not self.risks:
            raise ValueError("identified risk area must contain a concrete risk")
        if self.disposition is RiskDisposition.NOT_APPLICABLE and self.risks:
            raise ValueError("not-applicable risk area cannot contain a concrete risk")
        if any(risk.area is not self.area for risk in self.risks):
            raise ValueError("risk items must match the assessed area")
        return self


class RiskAssessment(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    feature_name: str = Field(min_length=1, max_length=200)
    areas: tuple[RiskAreaAssessment, ...] = Field(max_length=20)

    @field_validator("areas")
    @classmethod
    def require_complete_risk_coverage(
        cls,
        value: tuple[RiskAreaAssessment, ...],
    ) -> tuple[RiskAreaAssessment, ...]:
        areas = [assessment.area for assessment in value]
        if len(areas) != len(REQUIRED_RISK_AREAS) or set(areas) != set(
            REQUIRED_RISK_AREAS
        ):
            raise ValueError("risk assessment must cover every risk area exactly once")
        risk_ids = [risk.risk_id for assessment in value for risk in assessment.risks]
        if len(risk_ids) != len(set(risk_ids)):
            raise ValueError("risk IDs must be distinct")
        return value


class RiskTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    product_intent: ProductIntent

    @model_validator(mode="after")
    def require_approved_intent(self) -> RiskTask:
        if self.product_intent.status is not ProductAlignmentStatus.READY:
            raise ValueError("risk analysis requires a ready product intent")
        return self


class FeaturePlanningScopeError(ValueError):
    def __init__(self) -> None:
        super().__init__("planning output does not match the approved product intent")


def validate_strategy(
    strategy: TestStrategy,
    *,
    task: StrategyTask,
) -> TestStrategy:
    intent = task.product_intent
    if (
        strategy.project_id != intent.project_id
        or strategy.feature_name != intent.feature_name
    ):
        raise FeaturePlanningScopeError
    return strategy


def validate_risk_assessment(
    assessment: RiskAssessment,
    *,
    task: RiskTask,
) -> RiskAssessment:
    intent = task.product_intent
    if (
        assessment.project_id != intent.project_id
        or assessment.feature_name != intent.feature_name
    ):
        raise FeaturePlanningScopeError
    return assessment


__all__ = [
    "REQUIRED_COVERAGE_CONCERNS",
    "REQUIRED_RISK_AREAS",
    "CoverageConcern",
    "CoverageDecision",
    "CoverageDisposition",
    "FeaturePlanningScopeError",
    "RiskArea",
    "RiskAreaAssessment",
    "RiskAssessment",
    "RiskDisposition",
    "RiskItem",
    "RiskPriority",
    "RiskTask",
    "StrategyTask",
    "TestStrategy",
    "validate_risk_assessment",
    "validate_strategy",
]
