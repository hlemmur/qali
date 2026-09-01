from __future__ import annotations

import hashlib
from typing import Any, Protocol

from google.api_core.exceptions import AlreadyExists
from google.cloud import tasks_v2
from pydantic import BaseModel, ConfigDict, HttpUrl, field_validator

from app.slack_ingress import OnboardProjectJob


class CloudTasksSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    location: str
    queue_id: str
    worker_url: HttpUrl
    oidc_audience: HttpUrl
    service_account_email: str

    @field_validator("worker_url", "oidc_audience")
    @classmethod
    def require_https(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme != "https":
            raise ValueError("Cloud Tasks worker targets must use HTTPS")
        return value


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
        oidc_audience = str(settings.oidc_audience)
        try:
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
                                "audience": oidc_audience,
                            },
                        },
                    },
                }
            )
        except AlreadyExists:
            return


def _task_id(job_id: str) -> str:
    digest = hashlib.sha256(job_id.encode()).hexdigest()
    return f"qali-job-{digest}"


def create_cloud_tasks_dispatcher(
    settings: CloudTasksSettings,
) -> CloudTasksDispatcher:
    return CloudTasksDispatcher(
        settings=settings,
        client=tasks_v2.CloudTasksAsyncClient(),
    )


__all__ = [
    "CloudTasksDispatcher",
    "CloudTasksSettings",
    "create_cloud_tasks_dispatcher",
]
