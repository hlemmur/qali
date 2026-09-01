from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Callable
from typing import Literal, Protocol

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from slack_sdk.signature import Clock, SignatureVerifier


class SlackIngressSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    signing_secret: str
    workspace_id: str
    channel_id: str
    owner_user_id: str


class OnboardProjectJob(BaseModel):
    model_config = ConfigDict(frozen=True)

    job_id: str
    kind: Literal["onboard_project"] = "onboard_project"
    source_event_id: str
    workspace_id: str
    channel_id: str
    requester_user_id: str
    thread_ts: str
    request_text: str


class _SlackEvent(BaseModel):
    type: Literal["app_mention"]
    user: str
    channel: str
    ts: str
    text: str


class _SlackEnvelope(BaseModel):
    type: Literal["event_callback"]
    team_id: str
    event_id: str
    event: _SlackEvent


class _SlackUrlVerification(BaseModel):
    type: Literal["url_verification"]
    challenge: str


class JobRepository(Protocol):
    async def create(self, job: OnboardProjectJob) -> bool: ...


class TaskDispatcher(Protocol):
    async def dispatch(self, job: OnboardProjectJob) -> None: ...


class InMemoryJobRepository:
    def __init__(self) -> None:
        self._jobs: dict[str, OnboardProjectJob] = {}
        self._lock = asyncio.Lock()

    async def create(self, job: OnboardProjectJob) -> bool:
        async with self._lock:
            if job.job_id in self._jobs:
                return False
            self._jobs[job.job_id] = job
            return True

    def list_jobs(self) -> list[OnboardProjectJob]:
        return list(self._jobs.values())


class InMemoryTaskDispatcher:
    def __init__(self) -> None:
        self._job_ids: list[str] = []

    async def dispatch(self, job: OnboardProjectJob) -> None:
        self._job_ids.append(job.job_id)

    def dispatched_job_ids(self) -> list[str]:
        return list(self._job_ids)


class _CallableClock(Clock):
    def __init__(self, now: Callable[[], float]) -> None:
        self._now = now

    def now(self) -> float:
        return self._now()


def _is_onboarding_request(text: str) -> bool:
    command = re.sub(r"^\s*<@[^>]+>\s*", "", text).strip().casefold()
    return command == "onboard project" or command.startswith("onboard project ")


def create_slack_router(
    *,
    settings: SlackIngressSettings,
    jobs: JobRepository,
    tasks: TaskDispatcher,
    clock: Callable[[], float],
) -> APIRouter:
    router = APIRouter()
    verifier = SignatureVerifier(
        signing_secret=settings.signing_secret,
        clock=_CallableClock(clock),
    )

    @router.post("/slack/events")
    async def receive_slack_event(request: Request) -> dict[str, bool | str]:
        body = await request.body()
        if not verifier.is_valid(
            body=body,
            timestamp=request.headers.get("x-slack-request-timestamp"),
            signature=request.headers.get("x-slack-signature"),
        ):
            raise HTTPException(status_code=401, detail="invalid Slack signature")

        try:
            payload = json.loads(body)
            if isinstance(payload, dict) and payload.get("type") == "url_verification":
                verification = _SlackUrlVerification.model_validate(payload)
                return {"challenge": verification.challenge}
            envelope = _SlackEnvelope.model_validate(payload)
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="invalid Slack event") from exc

        event = envelope.event
        if (
            envelope.team_id != settings.workspace_id
            or event.channel != settings.channel_id
            or event.user != settings.owner_user_id
        ):
            raise HTTPException(status_code=403, detail="Slack event is not authorized")

        if not _is_onboarding_request(event.text):
            return {"ok": True}

        job = OnboardProjectJob(
            job_id=f"slack:{envelope.event_id}",
            source_event_id=envelope.event_id,
            workspace_id=envelope.team_id,
            channel_id=event.channel,
            requester_user_id=event.user,
            thread_ts=event.ts,
            request_text=event.text,
        )
        created = await jobs.create(job)
        if created:
            await tasks.dispatch(job)
        return {"ok": True}

    return router


__all__ = [
    "InMemoryJobRepository",
    "InMemoryTaskDispatcher",
    "OnboardProjectJob",
    "SlackIngressSettings",
    "create_slack_router",
]
