from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.feature_request_workflow import (
    FeatureRequestTask,
    FeatureRequestWorkflowResult,
)
from app.slack_progress import ProgressMessage


class FeatureTestJob(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    job_id: str = Field(min_length=1, max_length=256)
    kind: Literal["test_feature"] = "test_feature"
    source_event_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(min_length=1, max_length=128)
    workspace_id: str = Field(min_length=1, max_length=128)
    channel_id: str = Field(min_length=1, max_length=128)
    requester_user_id: str = Field(min_length=1, max_length=128)
    thread_ts: str = Field(min_length=1, max_length=64)
    run_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    feature_slug: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    request_text: str = Field(min_length=1, max_length=4_000)


class FeatureProgressRepository(Protocol):
    async def attach_progress(
        self,
        job_id: str,
        message: ProgressMessage,
    ) -> bool: ...

    async def get_progress(self, job_id: str) -> ProgressMessage | None: ...


class FeatureProgressReporter(Protocol):
    async def start(self, job: FeatureTestJob) -> ProgressMessage: ...


class FeatureRequestTaskLoader(Protocol):
    async def load(
        self,
        job: FeatureTestJob,
        *,
        progress_message: ProgressMessage,
    ) -> FeatureRequestTask: ...


class FeatureWorkflow(Protocol):
    async def run(self, task: FeatureRequestTask) -> FeatureRequestWorkflowResult: ...


class FeatureJobProcessor:
    def __init__(
        self,
        *,
        jobs: FeatureProgressRepository,
        progress: FeatureProgressReporter,
        tasks: FeatureRequestTaskLoader,
        workflow: FeatureWorkflow,
    ) -> None:
        self._jobs = jobs
        self._progress = progress
        self._tasks = tasks
        self._workflow = workflow

    async def process(self, job: FeatureTestJob) -> None:
        message = await self._jobs.get_progress(job.job_id)
        if message is None:
            message = await self._progress.start(job)
            if not await self._jobs.attach_progress(job.job_id, message):
                raise RuntimeError("could not attach feature progress message")
        task = FeatureRequestTask.model_validate(
            await self._tasks.load(job, progress_message=message)
        )
        if (
            task.alignment_task.project_id != job.project_id
            or task.alignment_task.request != job.request_text
            or task.run_id != job.run_id
            or task.feature_slug != job.feature_slug
            or task.progress_message != message
            or task.mock_mode
        ):
            raise RuntimeError(
                "feature request task does not match the claimed live job"
            )
        await self._workflow.run(task)


__all__ = [
    "FeatureJobProcessor",
    "FeatureProgressReporter",
    "FeatureRequestTaskLoader",
    "FeatureTestJob",
    "FeatureWorkflow",
]
