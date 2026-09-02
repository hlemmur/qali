import asyncio
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from app.cloud_tasks_dispatcher import (
    CloudTasksDispatcher,
    CloudTasksSettings,
    task_id_for_job,
)
from app.slack_ingress import InMemoryJobRepository, OnboardProjectJob
from app.worker_handler import JobExecutionSettings, LifecycleJobHandler
from app.worker_ingress import WorkerIngressSettings, create_worker_app


class _RecordingCloudTasksClient:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def queue_path(self, project: str, location: str, queue: str) -> str:
        return f"projects/{project}/locations/{location}/queues/{queue}"

    def task_path(
        self,
        project: str,
        location: str,
        queue: str,
        task: str,
    ) -> str:
        return f"{self.queue_path(project, location, queue)}/tasks/{task}"

    async def create_task(self, *, request: dict[str, Any]) -> None:
        self.requests.append(request)


class _RecordingJobHandler:
    def __init__(self) -> None:
        self.jobs: list[OnboardProjectJob] = []

    async def handle(self, job: OnboardProjectJob) -> None:
        self.jobs.append(job)


class _RecordingJobProcessor:
    def __init__(self) -> None:
        self.jobs: list[OnboardProjectJob] = []

    async def process(self, job: OnboardProjectJob) -> None:
        self.jobs.append(job)


class _FailOnceJobProcessor(_RecordingJobProcessor):
    def __init__(self) -> None:
        super().__init__()
        self.attempts = 0

    async def process(self, job: OnboardProjectJob) -> None:
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("synthetic processor failure")
        await super().process(job)


class _BlockingJobProcessor:
    def __init__(self) -> None:
        self.started = asyncio.Event()

    async def process(self, job: OnboardProjectJob) -> None:
        del job
        self.started.set()
        await asyncio.Event().wait()


@pytest.mark.parametrize("timeout_seconds", [0, 901])
def test_worker_timeout_budget_must_be_within_fifteen_minutes(
    timeout_seconds: float,
) -> None:
    with pytest.raises(ValidationError):
        JobExecutionSettings(timeout_seconds=timeout_seconds)


@pytest.mark.asyncio
async def test_dispatched_cloud_task_reaches_typed_worker_handler() -> None:
    cloud_tasks = _RecordingCloudTasksClient()
    dispatcher = CloudTasksDispatcher(
        settings=CloudTasksSettings(
            project_id="qali-507317",
            location="europe-west1",
            queue_id="qali-jobs",
            worker_url="https://qali-worker.example.test/internal/jobs",
            oidc_audience="https://qali-worker.example.test",
            service_account_email="qali-tasks@qali-507317.iam.gserviceaccount.com",
        ),
        client=cloud_tasks,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-worker-001",
        source_event_id="Ev-worker-001",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.005000",
        request_text="<@U-QALI> onboard project Example",
    )
    await dispatcher.dispatch(job)
    task = cloud_tasks.requests[0]["task"]
    handler = _RecordingJobHandler()
    app = create_worker_app(
        settings=WorkerIngressSettings(queue_name="qali-jobs"),
        handler=handler,
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        response = await client.post(
            "/internal/jobs",
            content=task["http_request"]["body"],
            headers={
                "Content-Type": "application/json",
                "X-CloudTasks-QueueName": "qali-jobs",
                "X-CloudTasks-TaskName": task["name"].rsplit("/", 1)[-1],
            },
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert handler.jobs == [job]


@pytest.mark.asyncio
async def test_worker_processes_and_completes_job_once_across_redelivery() -> None:
    jobs = InMemoryJobRepository()
    processor = _RecordingJobProcessor()
    handler = LifecycleJobHandler(jobs=jobs, processor=processor)
    app = create_worker_app(
        settings=WorkerIngressSettings(queue_name="qali-jobs"),
        handler=handler,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-worker-lifecycle",
        source_event_id="Ev-worker-lifecycle",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.013000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    headers = {
        "Content-Type": "application/json",
        "X-CloudTasks-QueueName": "qali-jobs",
        "X-CloudTasks-TaskName": task_id_for_job(job.job_id),
    }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        first = await client.post(
            "/internal/jobs",
            content=job.model_dump_json(),
            headers=headers,
        )
        redelivery = await client.post(
            "/internal/jobs",
            content=job.model_dump_json(),
            headers=headers,
        )

    assert first.status_code == 200
    assert redelivery.status_code == 200
    assert processor.jobs == [job]
    assert await jobs.claim(job.job_id) is None


@pytest.mark.asyncio
async def test_worker_releases_failed_job_for_cloud_tasks_retry() -> None:
    jobs = InMemoryJobRepository()
    processor = _FailOnceJobProcessor()
    handler = LifecycleJobHandler(jobs=jobs, processor=processor)
    app = create_worker_app(
        settings=WorkerIngressSettings(queue_name="qali-jobs"),
        handler=handler,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-worker-retry",
        source_event_id="Ev-worker-retry",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.014000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    headers = {
        "Content-Type": "application/json",
        "X-CloudTasks-QueueName": "qali-jobs",
        "X-CloudTasks-TaskName": task_id_for_job(job.job_id),
    }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://worker.test",
    ) as client:
        failed = await client.post(
            "/internal/jobs",
            content=job.model_dump_json(),
            headers=headers,
        )
        retry = await client.post(
            "/internal/jobs",
            content=job.model_dump_json(),
            headers=headers,
        )

    assert failed.status_code == 500
    assert retry.status_code == 200
    assert processor.attempts == 2
    assert processor.jobs == [job]


@pytest.mark.asyncio
async def test_worker_timeout_releases_job_for_retry() -> None:
    jobs = InMemoryJobRepository()
    handler = LifecycleJobHandler(
        jobs=jobs,
        processor=_BlockingJobProcessor(),
        settings=JobExecutionSettings(timeout_seconds=0.01),
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-worker-timeout",
        source_event_id="Ev-worker-timeout",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.015000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)

    with pytest.raises(TimeoutError):
        await handler.handle(job)

    assert await jobs.claim(job.job_id) == job


@pytest.mark.asyncio
async def test_worker_cancellation_releases_job_for_retry() -> None:
    jobs = InMemoryJobRepository()
    processor = _BlockingJobProcessor()
    handler = LifecycleJobHandler(jobs=jobs, processor=processor)
    job = OnboardProjectJob(
        job_id="slack:Ev-worker-cancelled",
        source_event_id="Ev-worker-cancelled",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.016000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    processing = asyncio.create_task(handler.handle(job))
    await processor.started.wait()

    processing.cancel()

    with pytest.raises(asyncio.CancelledError):
        await processing
    assert await jobs.claim(job.job_id) == job


@pytest.mark.asyncio
async def test_worker_rejects_task_from_unconfigured_queue() -> None:
    handler = _RecordingJobHandler()
    app = create_worker_app(
        settings=WorkerIngressSettings(queue_name="qali-jobs"),
        handler=handler,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-wrong-queue",
        source_event_id="Ev-wrong-queue",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.006000",
        request_text="<@U-QALI> onboard project Example",
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        response = await client.post(
            "/internal/jobs",
            content=job.model_dump_json(),
            headers={
                "Content-Type": "application/json",
                "X-CloudTasks-QueueName": "untrusted-queue",
                "X-CloudTasks-TaskName": "qali-job-untrusted",
            },
        )

    assert response.status_code == 403
    assert handler.jobs == []


@pytest.mark.asyncio
async def test_worker_rejects_payload_that_does_not_match_task_name() -> None:
    handler = _RecordingJobHandler()
    app = create_worker_app(
        settings=WorkerIngressSettings(queue_name="qali-jobs"),
        handler=handler,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-payload-mismatch",
        source_event_id="Ev-payload-mismatch",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.007000",
        request_text="<@U-QALI> onboard project Example",
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        response = await client.post(
            "/internal/jobs",
            content=job.model_dump_json(),
            headers={
                "Content-Type": "application/json",
                "X-CloudTasks-QueueName": "qali-jobs",
                "X-CloudTasks-TaskName": "qali-job-for-another-payload",
            },
        )

    assert response.status_code == 409
    assert handler.jobs == []
