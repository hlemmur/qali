from __future__ import annotations

from typing import Annotated, Protocol

from fastapi import FastAPI, Header, HTTPException
from google.adk.models.base_llm import BaseLlm

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
from app.job_lifecycle import ProjectBusyError
from app.plan_reviewer_agent import AdkPlanReviewer, create_plan_reviewer_agent
from app.product_alignment_agent import (
    AdkProductAlignmentAnalyst,
    create_product_alignment_agent,
)
from app.qa_strategy_agent import AdkQaStrategist, create_qa_strategy_agent
from app.risk_analysis_agent import AdkRiskAnalyst, create_risk_analysis_agent
from app.run_artifact_repository import (
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


def create_feature_worker_app(
    *,
    queue_name: str,
    jobs: FeatureJobRepository,
    progress: FeatureProgressReporter,
    tasks: FeatureRequestTaskLoader,
    workflow: FeatureWorkflow,
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
    app = FastAPI(
        title="Qali feature worker ingress",
        description="Receives typed feature jobs from the authenticated task queue.",
    )

    @app.post("/internal/feature-jobs")
    async def receive_feature_job(
        job: FeatureTestJob,
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


__all__ = [
    "FeatureJobRepository",
    "create_feature_worker_app",
    "create_production_feature_request_workflow",
]
