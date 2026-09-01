from typing import Any

import pytest

from app.cloud_tasks_dispatcher import CloudTasksDispatcher, CloudTasksSettings
from app.slack_ingress import OnboardProjectJob


class _RecordingCloudTasksClient:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.task_ids: list[str] = []

    def queue_path(self, project: str, location: str, queue: str) -> str:
        return f"projects/{project}/locations/{location}/queues/{queue}"

    def task_path(
        self,
        project: str,
        location: str,
        queue: str,
        task: str,
    ) -> str:
        self.task_ids.append(task)
        return f"{self.queue_path(project, location, queue)}/tasks/{task}"

    async def create_task(self, *, request: dict[str, Any]) -> None:
        self.requests.append(request)


@pytest.mark.asyncio
async def test_dispatch_creates_deterministic_authenticated_worker_task() -> None:
    client = _RecordingCloudTasksClient()
    dispatcher = CloudTasksDispatcher(
        settings=CloudTasksSettings(
            project_id="qali-507317",
            location="europe-west1",
            queue_id="qali-jobs",
            worker_url="https://qali-worker.example.test/internal/jobs",
            service_account_email="qali-tasks@qali-507317.iam.gserviceaccount.com",
        ),
        client=client,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-001",
        source_event_id="Ev-001",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.001000",
        request_text="<@U-QALI> onboard project Example",
    )

    await dispatcher.dispatch(job)
    await dispatcher.dispatch(job)

    assert len(client.requests) == 2
    assert len(client.task_ids) == 2
    assert client.task_ids[0] == client.task_ids[1]
    assert client.task_ids[0].startswith("qali-job-")
    assert client.requests[0] == client.requests[1]
    request = client.requests[0]
    assert request["parent"] == (
        "projects/qali-507317/locations/europe-west1/queues/qali-jobs"
    )
    assert request["task"] == {
        "name": (
            "projects/qali-507317/locations/europe-west1/queues/qali-jobs/tasks/"
            f"{client.task_ids[0]}"
        ),
        "http_request": {
            "http_method": "POST",
            "url": "https://qali-worker.example.test/internal/jobs",
            "headers": {"Content-Type": "application/json"},
            "body": job.model_dump_json().encode(),
            "oidc_token": {
                "service_account_email": (
                    "qali-tasks@qali-507317.iam.gserviceaccount.com"
                ),
                "audience": "https://qali-worker.example.test/internal/jobs",
            },
        },
    }
