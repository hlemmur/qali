"""Typed Cloud Tasks intake behind the worker service's Cloud Run IAM boundary.

Cloud Tasks headers provide task provenance, not caller identity. Production
authentication is enforced by a private Cloud Run service requiring the configured
task service account's OIDC identity before this application route is reached.
"""

from __future__ import annotations

from typing import Annotated, Protocol

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.cloud_tasks_dispatcher import task_id_for_job
from app.slack_ingress import OnboardProjectJob


class WorkerIngressSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    queue_name: str = Field(min_length=1)


class JobHandler(Protocol):
    async def handle(
        self,
        job: OnboardProjectJob,
        *,
        execution_count: int = 0,
    ) -> None: ...


def create_worker_app(
    *,
    settings: WorkerIngressSettings,
    handler: JobHandler,
) -> FastAPI:
    app = FastAPI(
        title="Qali worker ingress",
        description="Receives typed jobs from the authenticated Cloud Tasks queue.",
    )
    app.state.worker_ingress_settings = settings

    @app.post("/internal/jobs")
    async def receive_job(
        job: OnboardProjectJob,
        queue_name: Annotated[str, Header(alias="X-CloudTasks-QueueName")],
        task_name: Annotated[str, Header(alias="X-CloudTasks-TaskName")],
        execution_count: Annotated[
            int,
            Header(alias="X-CloudTasks-TaskExecutionCount", ge=0),
        ],
    ) -> dict[str, bool]:
        if queue_name != settings.queue_name:
            raise HTTPException(status_code=403, detail="unexpected Cloud Tasks queue")
        if task_name != task_id_for_job(job.job_id):
            raise HTTPException(
                status_code=409,
                detail="Cloud Tasks name does not match the job payload",
            )
        await handler.handle(job, execution_count=execution_count)
        return {"ok": True}

    return app


__all__ = ["JobHandler", "WorkerIngressSettings", "create_worker_app"]
