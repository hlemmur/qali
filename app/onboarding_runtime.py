from __future__ import annotations

from typing import Protocol

from fastapi import FastAPI
from google.adk.models.base_llm import BaseLlm
from pydantic import BaseModel, ConfigDict, Field

from app.knowledge_quality import KnowledgeQualityPolicy
from app.knowledge_source_loader import (
    KnowledgeSourceLoader,
    SourceIndex,
)
from app.knowledge_source_loader import (
    RawSourceRepository as LoaderRawSourceRepository,
)
from app.knowledge_workflow import KnowledgeRepository
from app.onboarding_processor import ProgressReporter
from app.onboarding_source_flow import ProjectRepository
from app.onboarding_worker_runtime import (
    OnboardingJobRepository,
    create_onboarding_worker_app,
)
from app.slack_file_client import (
    SlackFileClientSettings,
    create_slack_api_file_client,
)
from app.slack_file_fetcher import (
    AuthenticatedSlackFileClient,
    BoundedSlackFileFetcher,
)
from app.source_fetcher import BoundSourceTransport, SourceResolver
from app.source_ingestion import (
    RawSourceRepository as IngestionRawSourceRepository,
)
from app.source_ingestion import (
    SourceMetadataIndex,
)
from app.source_malware_scanner import (
    ClamAvMalwareScanner,
    ClamAvRunner,
    ClamAvSettings,
)
from app.source_runtime import SourceRuntimeSettings, create_onboarding_source_flow
from app.source_text_extraction import SourceTextExtractor
from app.worker_handler import JobExecutionSettings
from app.worker_ingress import WorkerIngressSettings


class RuntimeRawSourceRepository(
    IngestionRawSourceRepository,
    LoaderRawSourceRepository,
    Protocol,
):
    """Raw source boundary shared by ingestion and knowledge loading."""


class RuntimeSourceIndex(SourceMetadataIndex, SourceIndex, Protocol):
    """Source metadata boundary shared by ingestion and knowledge loading."""


class OnboardingRuntimeSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    worker: WorkerIngressSettings
    source: SourceRuntimeSettings
    clamav: ClamAvSettings
    slack_files: SlackFileClientSettings
    execution: JobExecutionSettings = Field(default_factory=JobExecutionSettings)


def create_onboarding_runtime(
    *,
    settings: OnboardingRuntimeSettings,
    jobs: OnboardingJobRepository,
    progress: ProgressReporter,
    projects: ProjectRepository,
    raw_sources: RuntimeRawSourceRepository,
    source_index: RuntimeSourceIndex,
    knowledge_repository: KnowledgeRepository,
    analyst_model: BaseLlm | str | None = None,
    reviewer_model: BaseLlm | str | None = None,
    quality_policy: KnowledgeQualityPolicy | None = None,
    resolver: SourceResolver | None = None,
    transport: BoundSourceTransport | None = None,
    clamav_runner: ClamAvRunner | None = None,
    slack_file_client: AuthenticatedSlackFileClient | None = None,
) -> FastAPI:
    """Compose the complete onboarding path behind its authenticated HTTP edge."""

    file_client = slack_file_client
    if file_client is None:
        file_client = create_slack_api_file_client(settings.slack_files)
    source_flow = create_onboarding_source_flow(
        settings=settings.source,
        projects=projects,
        malware_scanner=ClamAvMalwareScanner(
            settings=settings.clamav,
            runner=clamav_runner,
        ),
        raw_repository=raw_sources,
        source_index=source_index,
        resolver=resolver,
        transport=transport,
        file_fetcher=BoundedSlackFileFetcher(
            client=file_client,
            max_bytes=settings.source.max_bytes,
        ),
    )
    source_loader = KnowledgeSourceLoader(
        source_index=source_index,
        raw_sources=raw_sources,
        extractor=SourceTextExtractor(max_input_bytes=settings.source.max_bytes),
    )
    return create_onboarding_worker_app(
        settings=settings.worker,
        jobs=jobs,
        progress=progress,
        source_flow=source_flow,
        source_loader=source_loader,
        knowledge_repository=knowledge_repository,
        analyst_model=analyst_model,
        reviewer_model=reviewer_model,
        quality_policy=quality_policy,
        execution_settings=settings.execution,
    )


__all__ = [
    "OnboardingRuntimeSettings",
    "RuntimeRawSourceRepository",
    "RuntimeSourceIndex",
    "create_onboarding_runtime",
]
