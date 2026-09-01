from __future__ import annotations

import time
from collections.abc import Callable
from typing import Literal

from fastapi import FastAPI

from app.slack_ingress import (
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


__all__ = ["RuntimeMode", "create_slack_ingress_app"]
