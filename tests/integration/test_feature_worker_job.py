from __future__ import annotations

import httpx
import pytest

from app.cloud_tasks_dispatcher import task_id_for_job
from app.feature_worker_job import FeatureTestJob
from app.feature_worker_runtime import create_feature_worker_app
from app.job_lifecycle import JobFailureReason, JobRetryReason
from tests.integration.test_feature_request_workflow import _request_task
from tests.integration.test_slack_feature_results import _message


class _Jobs:
    def __init__(self, job: FeatureTestJob) -> None:
        self.job = job
        self.claimed = False
        self.completed = False
        self.progress = None

    async def claim(self, job_id: str):
        if job_id != self.job.job_id or self.claimed:
            return None
        self.claimed = True
        return self.job

    async def complete(self, job_id: str) -> bool:
        self.completed = job_id == self.job.job_id and self.claimed
        return self.completed

    async def release(self, job_id: str, *, reason: JobRetryReason) -> bool:
        del job_id, reason
        return True

    async def fail(self, job_id: str, *, reason: JobFailureReason) -> bool:
        del job_id, reason
        return True

    async def attach_progress(self, job_id: str, message) -> bool:
        if job_id != self.job.job_id:
            return False
        self.progress = message
        return True

    async def get_progress(self, job_id: str):
        return self.progress if job_id == self.job.job_id else None


class _Progress:
    async def start(self, job: FeatureTestJob):
        del job
        return _message()


class _Tasks:
    def __init__(self) -> None:
        self.calls = []

    async def load(self, job: FeatureTestJob, *, progress_message):
        self.calls.append((job, progress_message))
        base = _request_task(run_id=job.run_id, feature_slug=job.feature_slug)
        return base.model_copy(
            update={"progress_message": progress_message, "mock_mode": False}
        )


class _Workflow:
    def __init__(self) -> None:
        self.tasks = []

    async def run(self, task):
        self.tasks.append(task)


@pytest.mark.asyncio
async def test_typed_feature_job_runs_once_through_the_http_lifecycle_boundary() -> (
    None
):
    job = FeatureTestJob(
        job_id="slack:Ev-feature-001",
        source_event_id="Ev-feature-001",
        project_id="project-alpha",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788534000.001000",
        run_id="run-profile-request",
        feature_slug="profile-editing",
        request_text="Test profile display-name editing.",
    )
    jobs = _Jobs(job)
    tasks = _Tasks()
    workflow = _Workflow()
    app = create_feature_worker_app(
        queue_name="qali-jobs",
        jobs=jobs,
        progress=_Progress(),
        tasks=tasks,
        workflow=workflow,
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        response = await client.post(
            "/internal/feature-jobs",
            content=job.model_dump_json(),
            headers={
                "Content-Type": "application/json",
                "X-CloudTasks-QueueName": "qali-jobs",
                "X-CloudTasks-TaskName": task_id_for_job(job.job_id),
                "X-CloudTasks-TaskExecutionCount": "0",
            },
        )
        redelivery = await client.post(
            "/internal/feature-jobs",
            content=job.model_dump_json(),
            headers={
                "Content-Type": "application/json",
                "X-CloudTasks-QueueName": "qali-jobs",
                "X-CloudTasks-TaskName": task_id_for_job(job.job_id),
                "X-CloudTasks-TaskExecutionCount": "0",
            },
        )

    assert response.status_code == 200
    assert redelivery.status_code == 200
    assert jobs.completed is True
    assert tasks.calls == [(job, _message())]
    assert workflow.tasks == [
        _request_task(
            run_id=job.run_id,
            feature_slug=job.feature_slug,
        ).model_copy(update={"progress_message": _message(), "mock_mode": False})
    ]
