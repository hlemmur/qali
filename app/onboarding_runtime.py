from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Protocol

from fastapi import FastAPI
from google.adk.models.base_llm import BaseLlm
from pydantic import BaseModel, ConfigDict, Field

from app.browser_policy import BrowserTargetPolicy
from app.feature_context_repository import (
    GcsFeatureContextSettings,
    create_gcs_feature_context_repository,
)
from app.firestore_job_repository import (
    FirestoreJobSettings,
    create_firestore_job_repository,
)
from app.firestore_project_repository import (
    FirestoreProjectSettings,
    create_firestore_project_repository,
)
from app.firestore_source_repository import (
    FirestoreSourceSettings,
    create_firestore_source_repository,
)
from app.knowledge_quality import KnowledgeQualityPolicy
from app.knowledge_repository import (
    GcsKnowledgeSettings,
    create_gcs_knowledge_repository,
)
from app.knowledge_source_loader import (
    KnowledgeSourceLoader,
    SourceIndex,
)
from app.knowledge_source_loader import (
    RawSourceRepository as LoaderRawSourceRepository,
)
from app.knowledge_workflow import KnowledgeRepository
from app.onboarding_knowledge_flow import FeatureContextRepository
from app.onboarding_processor import ProgressReporter
from app.onboarding_source_flow import ProjectRepository
from app.onboarding_worker_runtime import (
    OnboardingJobRepository,
    create_onboarding_worker_app,
)
from app.raw_source_repository import (
    GcsRawSourceSettings,
    create_gcs_raw_source_repository,
)
from app.slack_file_client import (
    SlackFileClientSettings,
    create_slack_api_file_client,
)
from app.slack_file_fetcher import (
    AuthenticatedSlackFileClient,
    BoundedSlackFileFetcher,
)
from app.slack_progress import create_slack_progress_reporter
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
from app.source_url_policy import SourceUrlPolicy
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
    feature_context_repository: FeatureContextRepository | None = None,
    target_policy: BrowserTargetPolicy | None = None,
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
        feature_context_repository=feature_context_repository,
        target_policy=target_policy,
        analyst_model=analyst_model,
        reviewer_model=reviewer_model,
        quality_policy=quality_policy,
        execution_settings=settings.execution,
    )


def create_onboarding_runtime_from_env(
    environ: Mapping[str, str] | None = None,
) -> FastAPI:
    """Compose the live worker from explicit, fail-closed environment values."""

    values = os.environ if environ is None else environ
    if values.get("QALI_MODE") != "live":
        raise RuntimeError("QALI_MODE must be 'live' for the onboarding worker")
    if values.get("GOOGLE_GENAI_USE_VERTEXAI", "").casefold() != "false":
        raise RuntimeError(
            "GOOGLE_GENAI_USE_VERTEXAI must be 'false' for free-tier model use"
        )
    _required(values, "GEMINI_API_KEY")

    project_id = _required(values, "GOOGLE_CLOUD_PROJECT")
    database_id = _required(values, "FIRESTORE_DATABASE_ID")
    bucket_name = _required(values, "GCS_ARTIFACTS_BUCKET")
    storage_timeout = _required_int(values, "GCS_TIMEOUT_SECONDS")
    slack_token = _required(values, "SLACK_BOT_TOKEN")
    target_policy = BrowserTargetPolicy.model_validate_json(
        _required(values, "QALI_BROWSER_TARGET_POLICY_JSON")
    )
    settings = OnboardingRuntimeSettings(
        worker=WorkerIngressSettings(
            queue_name=_required(values, "CLOUD_TASKS_QUEUE_ID")
        ),
        source=SourceRuntimeSettings(
            allowed_origins=_required_csv(values, "QALI_ALLOWED_ORIGINS"),
            max_bytes=_required_int(values, "QALI_SOURCE_MAX_BYTES"),
            max_redirects=_required_int(values, "QALI_SOURCE_MAX_REDIRECTS"),
            timeout_seconds=_required_float(values, "QALI_SOURCE_TIMEOUT_SECONDS"),
            max_sources=_required_int(values, "QALI_SOURCE_MAX_SOURCES"),
        ),
        clamav=ClamAvSettings(
            executable=_required(values, "CLAMAV_EXECUTABLE"),
            timeout_seconds=_required_float(values, "CLAMAV_TIMEOUT_SECONDS"),
            scanner_id=_required(values, "CLAMAV_SCANNER_ID"),
        ),
        slack_files=SlackFileClientSettings(
            token=slack_token,
            timeout_seconds=_required_float(values, "SLACK_API_TIMEOUT_SECONDS"),
        ),
        execution=JobExecutionSettings(
            timeout_seconds=_required_float(values, "QALI_JOB_TIMEOUT_SECONDS"),
            max_delivery_attempts=_required_int(
                values,
                "QALI_JOB_MAX_DELIVERY_ATTEMPTS",
            ),
        ),
    )
    job_settings = FirestoreJobSettings(
        project_id=project_id,
        database_id=database_id,
        collection=_required(values, "FIRESTORE_JOBS_COLLECTION"),
        lock_collection=_required(
            values,
            "FIRESTORE_JOB_LOCKS_COLLECTION",
        ),
        lease_seconds=_required_int(values, "FIRESTORE_JOB_LEASE_SECONDS"),
    )
    project_settings = FirestoreProjectSettings(
        gcp_project_id=project_id,
        database_id=database_id,
        collection=_required(values, "FIRESTORE_PROJECTS_COLLECTION"),
    )
    source_index_settings = FirestoreSourceSettings(
        project_id=project_id,
        database_id=database_id,
        collection=_required(values, "FIRESTORE_SOURCES_COLLECTION"),
    )
    raw_source_settings = GcsRawSourceSettings(
        bucket_name=bucket_name,
        upload_timeout_seconds=storage_timeout,
    )
    knowledge_settings = GcsKnowledgeSettings(
        bucket_name=bucket_name,
        timeout_seconds=storage_timeout,
    )
    feature_context_settings = GcsFeatureContextSettings(
        bucket_name=bucket_name,
        timeout_seconds=storage_timeout,
    )
    source_policy = SourceUrlPolicy(
        allowed_origins=set(settings.source.allowed_origins)
    )
    for origin in settings.source.allowed_origins:
        source_policy.validate(origin)

    jobs = create_firestore_job_repository(job_settings)
    app = create_onboarding_runtime(
        settings=settings,
        jobs=jobs,
        progress=create_slack_progress_reporter(slack_token),
        projects=create_firestore_project_repository(project_settings),
        raw_sources=create_gcs_raw_source_repository(raw_source_settings),
        source_index=create_firestore_source_repository(source_index_settings),
        knowledge_repository=create_gcs_knowledge_repository(knowledge_settings),
        feature_context_repository=create_gcs_feature_context_repository(
            feature_context_settings
        ),
        target_policy=target_policy,
    )
    app.state.qali_mode = "live"
    app.state.onboarding_runtime_settings = settings
    app.state.feature_target_policy = target_policy
    return app


def _required(values: Mapping[str, str], name: str) -> str:
    value = values.get(name)
    if value is None or not value.strip():
        raise RuntimeError(f"{name} must be set in live mode")
    return value


def _required_int(values: Mapping[str, str], name: str) -> int:
    value = _required(values, name)
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def _required_float(values: Mapping[str, str], name: str) -> float:
    value = _required(values, name)
    try:
        return float(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc


def _required_csv(values: Mapping[str, str], name: str) -> tuple[str, ...]:
    entries = tuple(
        item.strip() for item in _required(values, name).split(",") if item.strip()
    )
    if not entries:
        raise RuntimeError(f"{name} must contain at least one value")
    return entries


__all__ = [
    "OnboardingRuntimeSettings",
    "RuntimeRawSourceRepository",
    "RuntimeSourceIndex",
    "create_onboarding_runtime",
    "create_onboarding_runtime_from_env",
]
