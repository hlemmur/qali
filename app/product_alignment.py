from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.knowledge_quality import KnowledgeCompilation


class ProductAlignmentStatus(StrEnum):
    READY = "ready"
    NEEDS_CLARIFICATION = "needs_clarification"


class GroundedProductStatement(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    statement: str = Field(min_length=1, max_length=2_000)
    source_ids: tuple[str, ...] = Field(min_length=1, max_length=20)

    @field_validator("source_ids")
    @classmethod
    def require_distinct_source_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value):
            raise ValueError("product statement source_ids must be distinct")
        return value


class ProductIntent(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    feature_name: str = Field(min_length=1, max_length=200)
    user_value: GroundedProductStatement
    expected_behaviors: tuple[GroundedProductStatement, ...] = Field(max_length=50)
    prerequisites: tuple[GroundedProductStatement, ...] = Field(max_length=50)
    in_scope: tuple[GroundedProductStatement, ...] = Field(
        min_length=1,
        max_length=50,
    )
    out_of_scope: tuple[str, ...] = Field(max_length=50)
    ambiguities: tuple[str, ...] = Field(max_length=20)
    status: ProductAlignmentStatus

    @model_validator(mode="after")
    def require_honest_readiness(self) -> ProductIntent:
        if self.status is ProductAlignmentStatus.READY and self.ambiguities:
            raise ValueError("ready product intent cannot contain ambiguities")
        if self.status is ProductAlignmentStatus.READY and not self.expected_behaviors:
            raise ValueError("ready product intent must include an expected behavior")
        if (
            self.status is ProductAlignmentStatus.NEEDS_CLARIFICATION
            and not self.ambiguities
        ):
            raise ValueError("product intent must include a clarification reason")
        return self


class ProductAlignmentTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    request: str = Field(min_length=1, max_length=4_000)
    knowledge: KnowledgeCompilation

    @model_validator(mode="after")
    def require_matching_project(self) -> ProductAlignmentTask:
        if self.project_id != self.knowledge.project_id:
            raise ValueError("product alignment knowledge must match the project")
        return self


class ProductAlignmentGroundingError(ValueError):
    def __init__(self) -> None:
        super().__init__("product intent contains invalid citations")


def validate_product_intent(
    intent: ProductIntent,
    *,
    task: ProductAlignmentTask,
) -> ProductIntent:
    available_source_ids = {
        source_id
        for item in (*task.knowledge.facts, *task.knowledge.contradictions)
        for source_id in item.source_ids
    }
    cited_source_ids = {
        source_id
        for item in (
            *intent.expected_behaviors,
            *intent.prerequisites,
            *intent.in_scope,
        )
        for source_id in item.source_ids
    }
    cited_source_ids.update(intent.user_value.source_ids)
    if intent.project_id != task.project_id or not cited_source_ids.issubset(
        available_source_ids
    ):
        raise ProductAlignmentGroundingError
    return intent


__all__ = [
    "GroundedProductStatement",
    "ProductAlignmentGroundingError",
    "ProductAlignmentStatus",
    "ProductAlignmentTask",
    "ProductIntent",
    "validate_product_intent",
]
