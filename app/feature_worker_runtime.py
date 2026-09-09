from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import PurePosixPath
from typing import Annotated, Any, Protocol

from fastapi import FastAPI, Header, HTTPException
from google.adk.models.base_llm import BaseLlm
from pydantic import BaseModel, ConfigDict, Field
from slack_sdk.web.async_client import AsyncWebClient

from app.browser_runtime import (
    BrowserRuntimeSettings,
    create_production_browser_attempt_runner,
)
from app.cloud_tasks_dispatcher import task_id_for_job
from app.failure_investigation import FailureInvestigationWorkflow
from app.failure_investigator_agents import (
    AdkFailureInvestigator,
    AdkFailureReviewer,
    create_failure_investigator_agent,
    create_failure_reviewer_agent,
)
from app.feature_context_loader import (
    ApprovedFeatureRequestTaskLoader,
    FeatureProjectContextRepository,
)
from app.feature_context_repository import (
    GcsFeatureContextSettings,
    create_gcs_feature_context_repository,
)
from app.feature_planning_workflow import FeaturePlanningWorkflow
from app.feature_request_workflow import FeatureRequestWorkflow
from app.feature_run_workflow import FeatureRunWorkflow
from app.feature_worker_job import (
    FeatureJobProcessor,
    FeatureProgressReporter,
    FeatureRequestTaskLoader,
    FeatureTestJob,
    FeatureWorkflow,
)
from app.finding_follow_up import (
    ExplainFindingJob,
    FindingFollowUpProcessor,
    SlackFindingFollowUpPublisher,
)
from app.firestore_job_repository import (
    FirestoreJobSettings,
    create_firestore_job_repository,
)
from app.job_lifecycle import ProjectBusyError
from app.plan_reviewer_agent import AdkPlanReviewer, create_plan_reviewer_agent
from app.product_alignment_agent import (
    AdkProductAlignmentAnalyst,
    create_product_alignment_agent,
)
from app.qa_strategy_agent import AdkQaStrategist, create_qa_strategy_agent
from app.risk_analysis_agent import AdkRiskAnalyst, create_risk_analysis_agent
from app.run_artifact_repository import (
    GcsRunArtifactRepository,
    GcsRunArtifactSettings,
    create_gcs_run_artifact_repository,
)
from app.slack_feature_results import (
    SlackFeatureResultClient,
    SlackFeatureResultPublisher,
)
from app.slack_progress import ProgressMessage
from app.test_designer_agent import AdkTestDesigner, create_test_designer_agent
from app.test_plan_workflow import TestPlanWorkflow
from app.worker_handler import (
    JobExecutionSettings,
    JobLifecycleRepository,
    LifecycleJobHandler,
)


class FeatureJobRepository(JobLifecycleRepository[FeatureTestJob], Protocol):
    async def attach_progress(
        self,
        job_id: str,
        message: ProgressMessage,
    ) -> bool: ...

    async def get_progress(self, job_id: str) -> ProgressMessage | None: ...


class FindingJobRepository(JobLifecycleRepository[ExplainFindingJob], Protocol):
    pass


class SlackFeatureWorkerClient(SlackFeatureResultClient, Protocol):
    async def chat_postMessage(
        self,
        *,
        channel: str,
        thread_ts: str,
        text: str,
        unfurl_links: bool,
        unfurl_media: bool,
        client_msg_id: str | None = None,
    ) -> Any: ...


class FeatureRuntimeSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    queue_name: str = Field(min_length=1)
    browser: BrowserRuntimeSettings
    context_bucket_name: str = Field(min_length=1)
    context_timeout_seconds: int = Field(default=60, ge=1, le=300)
    execution: JobExecutionSettings = Field(default_factory=JobExecutionSettings)


class SlackFeatureProgressReporter:
    def __init__(self, *, client: SlackFeatureWorkerClient) -> None:
        self._client = client

    async def start(self, job: FeatureTestJob) -> ProgressMessage:
        response = await self._client.chat_postMessage(
            channel=job.channel_id,
            thread_ts=job.thread_ts,
            text="Feature testing: request received.",
            unfurl_links=False,
            unfurl_media=False,
        )
        message_ts = response.get("ts")
        if not isinstance(message_ts, str) or not message_ts:
            raise RuntimeError("Slack did not return a progress message timestamp")
        return ProgressMessage(
            channel_id=job.channel_id,
            thread_ts=job.thread_ts,
            message_ts=message_ts,
        )


def create_feature_worker_app(
    *,
    queue_name: str,
    jobs: FeatureJobRepository,
    progress: FeatureProgressReporter,
    tasks: FeatureRequestTaskLoader,
    workflow: FeatureWorkflow,
    finding_follow_ups: FindingFollowUpProcessor | None = None,
    execution_settings: JobExecutionSettings | None = None,
) -> FastAPI:
    """Expose typed feature jobs behind the authenticated Cloud Tasks boundary."""

    if not queue_name:
        raise ValueError("queue_name must not be empty")
    processor = FeatureJobProcessor(
        jobs=jobs,
        progress=progress,
        tasks=tasks,
        workflow=workflow,
    )
    handler = LifecycleJobHandler[FeatureTestJob](
        jobs=jobs,
        processor=processor,
        settings=execution_settings,
    )
    finding_handler = (
        None
        if finding_follow_ups is None
        else LifecycleJobHandler[ExplainFindingJob](
            jobs=jobs,
            processor=finding_follow_ups,
            settings=execution_settings,
        )
    )
    app = FastAPI(
        title="Qali feature worker ingress",
        description="Receives typed feature jobs from the authenticated task queue.",
    )

    @app.post("/internal/feature-jobs")
    async def receive_feature_job(
        job: FeatureTestJob | ExplainFindingJob,
        received_queue_name: Annotated[
            str,
            Header(alias="X-CloudTasks-QueueName"),
        ],
        task_name: Annotated[str, Header(alias="X-CloudTasks-TaskName")],
        execution_count: Annotated[
            int,
            Header(alias="X-CloudTasks-TaskExecutionCount", ge=0),
        ],
    ) -> dict[str, bool]:
        if received_queue_name != queue_name:
            raise HTTPException(status_code=403, detail="unexpected Cloud Tasks queue")
        if task_name != task_id_for_job(job.job_id):
            raise HTTPException(
                status_code=409,
                detail="Cloud Tasks name does not match the job payload",
            )
        try:
            if isinstance(job, ExplainFindingJob):
                if finding_handler is None:
                    raise HTTPException(
                        status_code=503,
                        detail="finding follow-up is not configured",
                    )
                await finding_handler.handle(job, execution_count=execution_count)
            else:
                await handler.handle(job, execution_count=execution_count)
        except ProjectBusyError as exc:
            raise HTTPException(
                status_code=503,
                detail="project job is already running",
            ) from exc
        return {"ok": True}

    return app


def create_production_feature_request_workflow(
    *,
    browser_settings: BrowserRuntimeSettings,
    slack_client: SlackFeatureResultClient,
    specialist_model: BaseLlm | str | None = None,
    reviewer_model: BaseLlm | str | None = None,
) -> FeatureRequestWorkflow:
    """Compose the live one-feature workflow from production integration adapters."""

    browser = create_production_browser_attempt_runner(
        browser_settings,
        browser_model=specialist_model,
    )
    planning = FeaturePlanningWorkflow(
        alignment=AdkProductAlignmentAnalyst(
            agent=create_product_alignment_agent(model=specialist_model)
        ),
        strategist=AdkQaStrategist(
            agent=create_qa_strategy_agent(model=specialist_model)
        ),
        risk_analyst=AdkRiskAnalyst(
            agent=create_risk_analysis_agent(model=specialist_model)
        ),
        plan_workflow=TestPlanWorkflow(
            designer=AdkTestDesigner(
                agent=create_test_designer_agent(model=specialist_model)
            ),
            reviewer=AdkPlanReviewer(
                agent=create_plan_reviewer_agent(model=reviewer_model)
            ),
        ),
    )
    failure_workflow = FailureInvestigationWorkflow(
        reproducer=browser,
        investigator=AdkFailureInvestigator(
            agent=create_failure_investigator_agent(model=specialist_model)
        ),
        reviewer=AdkFailureReviewer(
            agent=create_failure_reviewer_agent(model=reviewer_model)
        ),
    )
    execution = FeatureRunWorkflow(
        scenario_runner=browser,
        failure_workflow=failure_workflow,
        artifacts=create_gcs_run_artifact_repository(
            GcsRunArtifactSettings(
                bucket_name=browser_settings.artifact_bucket_name,
                timeout_seconds=browser_settings.artifact_timeout_seconds,
            )
        ),
        slack_results=SlackFeatureResultPublisher(client=slack_client),
    )
    return FeatureRequestWorkflow(planning=planning, execution=execution)


def create_feature_worker_runtime(
    *,
    settings: FeatureRuntimeSettings,
    jobs: FeatureJobRepository,
    contexts: FeatureProjectContextRepository,
    slack_client: SlackFeatureWorkerClient,
    artifacts: GcsRunArtifactRepository | None = None,
    specialist_model: BaseLlm | str | None = None,
    reviewer_model: BaseLlm | str | None = None,
) -> FastAPI:
    """Compose the complete live feature-testing worker from typed boundaries."""

    workflow = create_production_feature_request_workflow(
        browser_settings=settings.browser,
        slack_client=slack_client,
        specialist_model=specialist_model,
        reviewer_model=reviewer_model,
    )
    app = create_feature_worker_app(
        queue_name=settings.queue_name,
        jobs=jobs,
        progress=SlackFeatureProgressReporter(client=slack_client),
        tasks=ApprovedFeatureRequestTaskLoader(contexts=contexts),
        workflow=workflow,
        finding_follow_ups=(
            None
            if artifacts is None
            else FindingFollowUpProcessor(
                artifacts=artifacts,
                publisher=SlackFindingFollowUpPublisher(client=slack_client),
                mock_mode=False,
            )
        ),
        execution_settings=settings.execution,
    )
    app.state.feature_runtime_settings = settings
    app.state.finding_follow_ups = artifacts is not None
    return app


def create_feature_worker_runtime_from_env(
    environ: Mapping[str, str] | None = None,
) -> FastAPI:
    """Compose the live feature worker from explicit, fail-closed environment."""

    values = os.environ if environ is None else environ
    if values.get("QALI_MODE") != "live":
        raise RuntimeError("QALI_MODE must be 'live' for the feature worker")
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
    settings = FeatureRuntimeSettings(
        queue_name=_required(values, "CLOUD_TASKS_QUEUE_ID"),
        browser=BrowserRuntimeSettings(
            output_root=PurePosixPath(_required(values, "PLAYWRIGHT_MCP_OUTPUT_ROOT")),
            gcp_project_id=project_id,
            artifact_bucket_name=bucket_name,
            artifact_timeout_seconds=storage_timeout,
            credential_timeout_seconds=_required_float(
                values,
                "SECRET_MANAGER_TIMEOUT_SECONDS",
            ),
        ),
        context_bucket_name=bucket_name,
        context_timeout_seconds=storage_timeout,
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
        lock_collection=_required(values, "FIRESTORE_JOB_LOCKS_COLLECTION"),
        lease_seconds=_required_int(values, "FIRESTORE_JOB_LEASE_SECONDS"),
    )
    context_settings = GcsFeatureContextSettings(
        bucket_name=settings.context_bucket_name,
        timeout_seconds=settings.context_timeout_seconds,
    )
    slack_client = create_slack_web_client(slack_token)
    artifacts = create_gcs_run_artifact_repository(
        GcsRunArtifactSettings(
            bucket_name=bucket_name,
            timeout_seconds=storage_timeout,
        )
    )
    app = create_feature_worker_runtime(
        settings=settings,
        jobs=create_firestore_job_repository(job_settings),
        contexts=create_gcs_feature_context_repository(context_settings),
        slack_client=slack_client,
        artifacts=artifacts,
    )
    app.state.qali_mode = "live"
    return app


def create_slack_web_client(token: str) -> AsyncWebClient:
    if not token.strip():
        raise ValueError("Slack bot token must not be empty")
    return AsyncWebClient(token=token)


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


__all__ = [
    "FeatureJobRepository",
    "FeatureRuntimeSettings",
    "FindingJobRepository",
    "SlackFeatureProgressReporter",
    "SlackFeatureWorkerClient",
    "create_feature_worker_app",
    "create_feature_worker_runtime",
    "create_feature_worker_runtime_from_env",
    "create_production_feature_request_workflow",
    "create_slack_web_client",
]
