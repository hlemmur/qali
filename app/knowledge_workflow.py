from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.knowledge_markdown import (
    CompiledKnowledgeDocument,
    compile_knowledge_markdown,
)
from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeQualityDecision,
    KnowledgeQualityPolicy,
    KnowledgeReadiness,
)
from app.knowledge_repository import KnowledgeArtifact
from app.source_text_extraction import KnowledgeSourceText


class KnowledgeAnalysisTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    sources: tuple[KnowledgeSourceText, ...] = Field(min_length=1, max_length=20)
    expected_generation: int = Field(ge=0)

    @field_validator("sources")
    @classmethod
    def require_distinct_sources(
        cls,
        value: tuple[KnowledgeSourceText, ...],
    ) -> tuple[KnowledgeSourceText, ...]:
        source_ids = [source.source_id for source in value]
        if len(set(source_ids)) != len(source_ids):
            raise ValueError("knowledge sources must have distinct source_ids")
        return value


class KnowledgeReview(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    approved: bool
    feedback: tuple[str, ...] = Field(max_length=10)

    @model_validator(mode="after")
    def require_rejection_feedback(self) -> KnowledgeReview:
        if not self.approved and not self.feedback:
            raise ValueError("rejected knowledge review requires feedback")
        if any(not item.strip() or len(item) > 1_000 for item in self.feedback):
            raise ValueError("knowledge review feedback is invalid")
        return self


class KnowledgeReviewTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    compilation: KnowledgeCompilation
    decision: KnowledgeQualityDecision
    sources: tuple[KnowledgeSourceText, ...]


class KnowledgeWorkflowResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    compilation: KnowledgeCompilation
    decision: KnowledgeQualityDecision
    document: CompiledKnowledgeDocument
    artifact: KnowledgeArtifact | None
    revision_count: int = Field(ge=0, le=1)


class KnowledgeAnalyst(Protocol):
    async def compile(self, task: KnowledgeAnalysisTask) -> KnowledgeCompilation: ...

    async def revise(
        self,
        task: KnowledgeAnalysisTask,
        prior: KnowledgeCompilation,
        feedback: tuple[str, ...],
    ) -> KnowledgeCompilation: ...


class KnowledgeReviewer(Protocol):
    async def review(self, task: KnowledgeReviewTask) -> KnowledgeReview: ...


class KnowledgeRepository(Protocol):
    async def publish(
        self,
        document: CompiledKnowledgeDocument,
        *,
        expected_generation: int,
    ) -> KnowledgeArtifact: ...


class KnowledgeWorkflowError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("knowledge workflow output is invalid")


class KnowledgeReviewRejected(RuntimeError):
    def __init__(self) -> None:
        super().__init__("knowledge review rejected after revision")


class KnowledgeWorkflow:
    def __init__(
        self,
        *,
        analyst: KnowledgeAnalyst,
        reviewer: KnowledgeReviewer,
        repository: KnowledgeRepository,
        quality_policy: KnowledgeQualityPolicy | None = None,
    ) -> None:
        self._analyst = analyst
        self._reviewer = reviewer
        self._repository = repository
        self._quality_policy = quality_policy or KnowledgeQualityPolicy()

    async def run(self, task: KnowledgeAnalysisTask) -> KnowledgeWorkflowResult:
        compilation = await self._analyst.compile(task)
        decision = self._evaluate(task, compilation)
        review = await self._reviewer.review(
            KnowledgeReviewTask(
                compilation=compilation,
                decision=decision,
                sources=task.sources,
            )
        )
        revision_count = 0
        if not review.approved:
            compilation = await self._analyst.revise(
                task,
                compilation,
                review.feedback,
            )
            revision_count = 1
            decision = self._evaluate(task, compilation)
            review = await self._reviewer.review(
                KnowledgeReviewTask(
                    compilation=compilation,
                    decision=decision,
                    sources=task.sources,
                )
            )
            if not review.approved:
                raise KnowledgeReviewRejected

        document = compile_knowledge_markdown(compilation, decision)
        artifact = None
        if decision.readiness is KnowledgeReadiness.READY:
            artifact = await self._repository.publish(
                document,
                expected_generation=task.expected_generation,
            )
        return KnowledgeWorkflowResult(
            compilation=compilation,
            decision=decision,
            document=document,
            artifact=artifact,
            revision_count=revision_count,
        )

    def _evaluate(
        self,
        task: KnowledgeAnalysisTask,
        compilation: KnowledgeCompilation,
    ) -> KnowledgeQualityDecision:
        if compilation.project_id != task.project_id:
            raise KnowledgeWorkflowError
        return self._quality_policy.evaluate(
            compilation,
            available_source_ids={source.source_id for source in task.sources},
        )


__all__ = [
    "KnowledgeAnalysisTask",
    "KnowledgeReview",
    "KnowledgeReviewRejected",
    "KnowledgeReviewTask",
    "KnowledgeWorkflow",
    "KnowledgeWorkflowError",
    "KnowledgeWorkflowResult",
]
