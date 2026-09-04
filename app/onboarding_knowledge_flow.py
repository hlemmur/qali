from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, ConfigDict

from app.knowledge_workflow import (
    KnowledgeAnalysisTask,
    KnowledgeWorkflowResult,
)
from app.onboarding_source_flow import OnboardingSourceResult
from app.slack_ingress import OnboardProjectJob


class SourceFlow(Protocol):
    async def ingest(self, job: OnboardProjectJob) -> OnboardingSourceResult: ...


class SourceLoader(Protocol):
    async def load(
        self,
        project_id: str,
        *,
        expected_generation: int,
    ) -> KnowledgeAnalysisTask: ...


class KnowledgeWorkflow(Protocol):
    async def run(self, task: KnowledgeAnalysisTask) -> KnowledgeWorkflowResult: ...


class OnboardingKnowledgeIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("onboarding knowledge graph integrity failed")


class OnboardingKnowledgeResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    source_result: OnboardingSourceResult
    analysis_task: KnowledgeAnalysisTask
    knowledge: KnowledgeWorkflowResult


class OnboardingKnowledgeFlow:
    def __init__(
        self,
        *,
        source_flow: SourceFlow,
        source_loader: SourceLoader,
        knowledge_workflow: KnowledgeWorkflow,
    ) -> None:
        self._source_flow = source_flow
        self._source_loader = source_loader
        self._knowledge_workflow = knowledge_workflow

    async def run(
        self,
        job: OnboardProjectJob,
        *,
        expected_generation: int,
    ) -> OnboardingKnowledgeResult:
        source_result = await self._source_flow.ingest(job)
        analysis_task = await self._source_loader.load(
            source_result.project.project_id,
            expected_generation=expected_generation,
        )
        ingested_source_ids = {
            artifact.source_id for artifact in source_result.artifacts
        }
        analysis_source_ids = {source.source_id for source in analysis_task.sources}
        if (
            analysis_task.project_id != source_result.project.project_id
            or not ingested_source_ids.issubset(analysis_source_ids)
        ):
            raise OnboardingKnowledgeIntegrityError
        knowledge = await self._knowledge_workflow.run(analysis_task)
        return OnboardingKnowledgeResult(
            source_result=source_result,
            analysis_task=analysis_task,
            knowledge=knowledge,
        )


__all__ = [
    "OnboardingKnowledgeFlow",
    "OnboardingKnowledgeIntegrityError",
    "OnboardingKnowledgeResult",
]
