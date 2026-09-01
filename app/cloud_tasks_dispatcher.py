from __future__ import annotations

import hashlib
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, HttpUrl

from app.slack_ingress import OnboardProjectJob


class CloudTasksSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    project_id: str
    location: str
    queue_id: str
    worker_url: HttpUrl
    service_account_email: str


class CloudTasksClient(Protocol):
    def queue_path(self, project: str, location: str, queue: str) -> str: ...

    def task_path(
        self,
        project: str,
        location: str,
        queue: str,
        task: str,
    ) -> str: ...

    async def create_task(self, *, request: dict[str, Any]) -> Any: ...


class CloudTasksDispatcher:
    def __init__(
        self,
        *,
        settings: CloudTasksSettings,
        client: CloudTasksClient,
    ) -> None:
        self._settings = settings
        self._client = client

    async def dispatch(self, job: OnboardProjectJob) -> None:
        settings = self._settings
        parent = self._client.queue_path(
            settings.project_id,
            settings.location,
            settings.queue_id,
        )
        task_id = _task_id(job.job_id)
        task_name = self._client.task_path(
            settings.project_id,
            settings.location,
            settings.queue_id,
            task_id,
        )
        worker_url = str(settings.worker_url)
        await self._client.create_task(
            request={
                "parent": parent,
                "task": {
                    "name": task_name,
                    "http_request": {
                        "http_method": "POST",
                        "url": worker_url,
                        "headers": {"Content-Type": "application/json"},
                        "body": job.model_dump_json().encode(),
                        "oidc_token": {
                            "service_account_email": settings.service_account_email,
                            "audience": worker_url,
                        },
                    },
                },
            }
        )


def _task_id(job_id: str) -> str:
    digest = hashlib.sha256(job_id.encode()).hexdigest()
    return f"qali-job-{digest}"


__all__ = ["CloudTasksDispatcher", "CloudTasksSettings"]
