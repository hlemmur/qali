from __future__ import annotations

import os
import time
from collections.abc import Callable, Mapping
from typing import Literal

from fastapi import FastAPI

from app.cloud_tasks_dispatcher import (
    CloudTasksSettings,
    create_cloud_tasks_dispatcher,
)
from app.firestore_job_repository import (
    FirestoreJobSettings,
    create_firestore_job_repository,
)
from app.slack_ingress import (
    InMemoryJobRepository,
    InMemoryTaskDispatcher,
    JobRepository,
    SlackIngressSettings,
    TaskDispatcher,
    create_slack_router,
)

RuntimeMode = Literal["mock", "live"]


def create_slack_ingress_app(
    *,
    settings: SlackIngressSettings,
    jobs: JobRepository,
    tasks: TaskDispatcher,
    mode: RuntimeMode,
    clock: Callable[[], float] = time.time,
) -> FastAPI:
    app = FastAPI(
        title="Qali Slack ingress",
        description="Validates Slack events and dispatches typed Qali jobs.",
    )
    app.state.qali_mode = mode
    app.include_router(
        create_slack_router(
            settings=settings,
            jobs=jobs,
            tasks=tasks,
            clock=clock,
        )
    )

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        badge = "MOCK MODE" if mode == "mock" else "LIVE MODE"
        return {"status": "ok", "mode": mode, "badge": badge}

    return app


def create_slack_ingress_app_from_env(
    environ: Mapping[str, str] | None = None,
) -> FastAPI:
    values = os.environ if environ is None else environ
    mode = values.get("QALI_MODE")
    if mode is None:
        raise RuntimeError("QALI_MODE must be set explicitly")
    if mode == "live":
        project_id = _required(values, "GOOGLE_CLOUD_PROJECT")
        slack_settings = SlackIngressSettings(
            signing_secret=_required(values, "SLACK_SIGNING_SECRET"),
            workspace_id=_required(values, "SLACK_WORKSPACE_ID"),
            channel_id=_required(values, "SLACK_CHANNEL_ID"),
            owner_user_id=_required(values, "SLACK_OWNER_USER_ID"),
        )
        firestore_settings = FirestoreJobSettings(
            project_id=project_id,
            database_id=_required(values, "FIRESTORE_DATABASE_ID"),
            collection=_required(values, "FIRESTORE_JOBS_COLLECTION"),
            lock_collection=_required(values, "FIRESTORE_JOB_LOCKS_COLLECTION"),
        )
        cloud_tasks_settings = CloudTasksSettings(
            project_id=project_id,
            location=_required(values, "CLOUD_TASKS_LOCATION"),
            queue_id=_required(values, "CLOUD_TASKS_QUEUE_ID"),
            worker_url=_required(values, "QALI_WORKER_URL"),
            oidc_audience=_required(values, "QALI_WORKER_OIDC_AUDIENCE"),
            service_account_email=_required(values, "QALI_TASKS_SERVICE_ACCOUNT_EMAIL"),
        )
        return create_slack_ingress_app(
            settings=slack_settings,
            jobs=create_firestore_job_repository(firestore_settings),
            tasks=create_cloud_tasks_dispatcher(cloud_tasks_settings),
            mode="live",
        )
    if mode != "mock":
        raise RuntimeError("QALI_MODE must be either 'mock' or 'live'")

    return create_slack_ingress_app(
        settings=SlackIngressSettings(
            signing_secret=values.get(
                "SLACK_SIGNING_SECRET", "mock-slack-signing-secret"
            ),
            workspace_id=values.get("SLACK_WORKSPACE_ID", "T-MOCK-QALI"),
            channel_id=values.get("SLACK_CHANNEL_ID", "C-MOCK-QALI"),
            owner_user_id=values.get("SLACK_OWNER_USER_ID", "U-MOCK-OWNER"),
        ),
        jobs=InMemoryJobRepository(),
        tasks=InMemoryTaskDispatcher(),
        mode="mock",
    )


def _required(values: Mapping[str, str], name: str) -> str:
    value = values.get(name)
    if value is None or not value.strip():
        raise RuntimeError(f"{name} must be set in live mode")
    return value


__all__ = [
    "RuntimeMode",
    "create_slack_ingress_app",
    "create_slack_ingress_app_from_env",
]
