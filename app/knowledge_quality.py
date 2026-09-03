from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class KnowledgeConfidence(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class KnowledgeReadiness(StrEnum):
    READY = "ready"
    INSUFFICIENT = "insufficient"


class KnowledgeQualityReason(StrEnum):
    NO_GROUNDED_FACTS = "no_grounded_facts"
    LOW_CONFIDENCE = "low_confidence"
    BLOCKING_GAPS = "blocking_gaps"


class KnowledgeFact(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    statement: str = Field(min_length=1, max_length=2_000)
    source_ids: tuple[str, ...] = Field(min_length=1, max_length=20)

    @field_validator("source_ids")
    @classmethod
    def require_distinct_source_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value):
            raise ValueError("fact source_ids must be distinct")
        return value


class KnowledgeContradiction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    description: str = Field(min_length=1, max_length=2_000)
    source_ids: tuple[str, ...] = Field(min_length=2, max_length=20)

    @field_validator("source_ids")
    @classmethod
    def require_distinct_source_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value):
            raise ValueError("contradiction source_ids must be distinct")
        return value


class KnowledgeGap(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    description: str = Field(min_length=1, max_length=2_000)
    blocking: bool


class KnowledgeCompilation(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    overview: str = Field(min_length=1, max_length=4_000)
    facts: tuple[KnowledgeFact, ...] = Field(max_length=200)
    contradictions: tuple[KnowledgeContradiction, ...] = Field(max_length=100)
    gaps: tuple[KnowledgeGap, ...] = Field(max_length=100)
    confidence: KnowledgeConfidence


class KnowledgeQualityDecision(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    readiness: KnowledgeReadiness
    reasons: tuple[KnowledgeQualityReason, ...]


class KnowledgeGroundingError(ValueError):
    def __init__(self) -> None:
        super().__init__("knowledge output contains invalid citations")


class KnowledgeQualityPolicy:
    def __init__(
        self,
        *,
        minimum_confidence: KnowledgeConfidence | None = None,
    ) -> None:
        self._minimum_confidence = minimum_confidence or KnowledgeConfidence.MEDIUM

    def evaluate(
        self,
        compilation: KnowledgeCompilation,
        *,
        available_source_ids: set[str],
    ) -> KnowledgeQualityDecision:
        cited_source_ids = {
            source_id
            for item in (*compilation.facts, *compilation.contradictions)
            for source_id in item.source_ids
        }
        if not cited_source_ids.issubset(available_source_ids):
            raise KnowledgeGroundingError

        reasons: list[KnowledgeQualityReason] = []
        if not compilation.facts:
            reasons.append(KnowledgeQualityReason.NO_GROUNDED_FACTS)
        confidence_rank = {
            KnowledgeConfidence.LOW: 0,
            KnowledgeConfidence.MEDIUM: 1,
            KnowledgeConfidence.HIGH: 2,
        }
        if (
            confidence_rank[compilation.confidence]
            < confidence_rank[self._minimum_confidence]
        ):
            reasons.append(KnowledgeQualityReason.LOW_CONFIDENCE)
        if any(gap.blocking for gap in compilation.gaps):
            reasons.append(KnowledgeQualityReason.BLOCKING_GAPS)
        readiness = (
            KnowledgeReadiness.READY if not reasons else KnowledgeReadiness.INSUFFICIENT
        )
        return KnowledgeQualityDecision(readiness=readiness, reasons=tuple(reasons))


__all__ = [
    "KnowledgeCompilation",
    "KnowledgeConfidence",
    "KnowledgeContradiction",
    "KnowledgeFact",
    "KnowledgeGap",
    "KnowledgeGroundingError",
    "KnowledgeQualityDecision",
    "KnowledgeQualityPolicy",
    "KnowledgeQualityReason",
    "KnowledgeReadiness",
]
