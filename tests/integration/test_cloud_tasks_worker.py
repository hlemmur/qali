from typing import Any

import httpx
import pytest

from app.cloud_tasks_dispatcher import CloudTasksDispatcher, CloudTasksSettings
from app.slack_ingress import OnboardProjectJob
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
