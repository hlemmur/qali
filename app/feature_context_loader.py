from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.browser_policy import BrowserTargetPolicy
from app.feature_request_workflow import FeatureRequestTask
from app.feature_worker_job import FeatureTestJob
from app.knowledge_quality import KnowledgeCompilation, KnowledgeReadiness
from app.product_alignment import ProductAlignmentTask
from app.slack_progress import ProgressMessage


class FeatureProjectContext(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    workspace_id: str = Field(min_length=1, max_length=128)
    channel_id: str = Field(min_length=1, max_length=128)
    readiness: KnowledgeReadiness
    knowledge: KnowledgeCompilation
    target_policy: BrowserTargetPolicy

    @model_validator(mode="after")
    def require_matching_project_scope(self) -> FeatureProjectContext:
        if (
            self.knowledge.project_id != self.project_id
            or self.target_policy.project_id != self.project_id
        ):
            raise ValueError("feature project context scopes must match")
        return self


class FeatureProjectContextRepository(Protocol):
    async def load(self, project_id: str) -> FeatureProjectContext: ...


class FeatureContextUnavailable(RuntimeError):
    pass


class ApprovedFeatureRequestTaskLoader:
    def __init__(self, *, contexts: FeatureProjectContextRepository) -> None:
        self._contexts = contexts

    async def load(
        self,
        job: FeatureTestJob,
        *,
        progress_message: ProgressMessage,
    ) -> FeatureRequestTask:
        try:
            stored_context = await self._contexts.load(job.project_id)
            context = FeatureProjectContext.model_validate(stored_context)
        except Exception:
            raise FeatureContextUnavailable(
                "approved feature context is unavailable"
            ) from None
        if (
            context.project_id != job.project_id
            or context.workspace_id != job.workspace_id
            or context.channel_id != job.channel_id
        ):
            raise FeatureContextUnavailable(
                "approved feature context does not match the claimed job"
            )
        if context.readiness is not KnowledgeReadiness.READY:
            raise FeatureContextUnavailable("project knowledge is not ready")
        return FeatureRequestTask(
            alignment_task=ProductAlignmentTask(
                project_id=context.project_id,
                request=job.request_text,
                knowledge=context.knowledge,
            ),
            run_id=job.run_id,
            feature_slug=job.feature_slug,
            target_policy=context.target_policy,
            progress_message=progress_message,
            mock_mode=False,
        )


__all__ = [
    "ApprovedFeatureRequestTaskLoader",
    "FeatureContextUnavailable",
    "FeatureProjectContext",
    "FeatureProjectContextRepository",
]
