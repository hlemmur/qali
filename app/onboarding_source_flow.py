from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.firestore_project_repository import ProjectChannelBinding
from app.onboarding_source_extraction import extract_onboarding_sources
from app.raw_source_repository import RawSourceArtifact
from app.slack_ingress import OnboardProjectJob
from app.source_ingestion import (
    OnboardingFileSourceRequest,
    OnboardingInlineSourceRequest,
    OnboardingSourceRequest,
)


class ProjectRepository(Protocol):
    async def resolve_or_create(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        created_by: str,
    ) -> ProjectChannelBinding: ...


class SourceIngestion(Protocol):
    async def ingest(
        self,
        request: OnboardingSourceRequest,
    ) -> RawSourceArtifact: ...

    async def ingest_inline(
        self,
        request: OnboardingInlineSourceRequest,
    ) -> RawSourceArtifact: ...

    async def ingest_file(
        self,
        request: OnboardingFileSourceRequest,
    ) -> RawSourceArtifact: ...


class OnboardingSourcesRequired(ValueError):
    def __init__(self) -> None:
        super().__init__("onboarding requires at least one source")


class OnboardingSourceLimitExceeded(ValueError):
    def __init__(self) -> None:
        super().__init__("onboarding source count exceeds limit")


class OnboardingSourceIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("onboarding source result failed integrity check")


class OnboardingSourceResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project: ProjectChannelBinding
    artifacts: tuple[RawSourceArtifact, ...] = Field(min_length=1, max_length=20)


class OnboardingSourceFlow:
    def __init__(
        self,
        *,
        projects: ProjectRepository,
        ingestion: SourceIngestion,
        max_sources: int = 10,
    ) -> None:
        if not 1 <= max_sources <= 20:
            raise ValueError("max_sources must be between 1 and 20")
        self._projects = projects
        self._ingestion = ingestion
        self._max_sources = max_sources

    async def process(self, job: OnboardProjectJob) -> None:
        await self.ingest(job)

    async def ingest(self, job: OnboardProjectJob) -> OnboardingSourceResult:
        sources = extract_onboarding_sources(job)
        source_count = (
            len(sources.urls) + len(sources.files) + (sources.text is not None)
        )
        if source_count == 0:
            raise OnboardingSourcesRequired
        if source_count > self._max_sources:
            raise OnboardingSourceLimitExceeded

        project = await self._projects.resolve_or_create(
            workspace_id=job.workspace_id,
            channel_id=job.channel_id,
            created_by=sources.author_ref,
        )
        artifacts: list[RawSourceArtifact] = []
        if sources.text is not None:
            artifact = await self._ingestion.ingest_inline(
                OnboardingInlineSourceRequest(
                    project_id=project.project_id,
                    source_id=sources.text.source_id,
                    workspace_id=job.workspace_id,
                    channel_id=job.channel_id,
                    source_event_id=job.source_event_id,
                    content=sources.text.content,
                    author_ref=sources.author_ref,
                )
            )
            artifacts.append(
                _require_artifact(artifact, project.project_id, sources.text.source_id)
            )
        for source in sources.urls:
            artifact = await self._ingestion.ingest(
                OnboardingSourceRequest(
                    project_id=project.project_id,
                    source_id=source.source_id,
                    url=source.url,
                    author_ref=sources.author_ref,
                )
            )
            artifacts.append(
                _require_artifact(artifact, project.project_id, source.source_id)
            )
        for source in sources.files:
            artifact = await self._ingestion.ingest_file(
                OnboardingFileSourceRequest(
                    project_id=project.project_id,
                    source_id=source.source_id,
                    reference=source.reference,
                    author_ref=sources.author_ref,
                )
            )
            artifacts.append(
                _require_artifact(artifact, project.project_id, source.source_id)
            )
        return OnboardingSourceResult(project=project, artifacts=tuple(artifacts))


def _require_artifact(
    artifact: RawSourceArtifact,
    project_id: str,
    source_id: str,
) -> RawSourceArtifact:
    if artifact.project_id != project_id or artifact.source_id != source_id:
        raise OnboardingSourceIntegrityError
    return artifact


__all__ = [
    "OnboardingSourceFlow",
    "OnboardingSourceIntegrityError",
    "OnboardingSourceLimitExceeded",
    "OnboardingSourceResult",
    "OnboardingSourcesRequired",
]
