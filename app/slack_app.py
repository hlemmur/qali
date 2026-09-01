from __future__ import annotations

import os
import time
from collections.abc import Callable, Mapping
from typing import Literal

from fastapi import FastAPI

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
        raise RuntimeError(
            "live ingress is unavailable until durable job and task adapters are configured"
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


__all__ = [
    "RuntimeMode",
    "create_slack_ingress_app",
    "create_slack_ingress_app_from_env",
]
