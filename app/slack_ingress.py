from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Literal, Protocol, TypeAlias

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from slack_sdk.signature import Clock, SignatureVerifier

from app.job_lifecycle import JobFailureReason, JobRetryReason, ProjectBusyError
from app.project_identity import project_id_for_channel

if TYPE_CHECKING:
    from app.feature_worker_job import FeatureTestJob
    from app.finding_follow_up import ExplainFindingJob
    from app.slack_progress import ProgressMessage


class SlackIngressSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    signing_secret: str
    workspace_id: str
    channel_id: str
    owner_user_id: str


class SlackFileReference(BaseModel):
    model_config = ConfigDict(
        frozen=True,
        extra="ignore",
        populate_by_name=True,
    )

    file_id: str = Field(alias="id", min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    media_type: Literal[
        "text/markdown",
        "text/plain",
        "application/pdf",
    ] = Field(alias="mimetype")
    size_bytes: int = Field(alias="size", gt=0, le=5_000_000)


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
    files: tuple[SlackFileReference, ...] = Field(default=(), max_length=10)


if TYPE_CHECKING:
    DurableSlackJob: TypeAlias = OnboardProjectJob | FeatureTestJob | ExplainFindingJob
else:
    DurableSlackJob: TypeAlias = OnboardProjectJob


class _SlackEvent(BaseModel):
    type: Literal["app_mention"]
    user: str
    channel: str
    ts: str
    text: str
    files: tuple[SlackFileReference, ...] = Field(default=(), max_length=10)


class _SlackEnvelope(BaseModel):
    type: Literal["event_callback"]
    team_id: str
    event_id: str
    event: _SlackEvent


class _SlackUrlVerification(BaseModel):
    type: Literal["url_verification"]
    challenge: str


class JobRepository(Protocol):
    async def create(self, job: DurableSlackJob) -> bool: ...


class TaskDispatcher(Protocol):
    """Dispatch a job idempotently using its deterministic job ID."""

    async def dispatch(self, job: DurableSlackJob) -> None: ...


class InMemoryJobRepository:
    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        lease_seconds: int = 960,
    ) -> None:
        if not 900 < lease_seconds <= 3_600:
            raise ValueError("lease_seconds must be greater than 900 and at most 3600")
        self._jobs: dict[str, DurableSlackJob] = {}
        self._claimed_job_ids: set[str] = set()
        self._completed_job_ids: set[str] = set()
        self._failed_job_ids: set[str] = set()
        self._active_job_by_project: dict[tuple[str, str], tuple[str, float]] = {}
        self._progress_by_job_id: dict[str, ProgressMessage] = {}
        self._clock = clock
        self._lease_seconds = lease_seconds
        self._lock = asyncio.Lock()

    async def create(self, job: DurableSlackJob) -> bool:
        async with self._lock:
            if job.job_id in self._jobs:
                return False
            self._jobs[job.job_id] = job
            return True

    async def claim(self, job_id: str) -> DurableSlackJob | None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if (
                job is None
                or job_id in self._completed_job_ids
                or job_id in self._failed_job_ids
            ):
                return None
            project_key = (job.workspace_id, job.channel_id)
            active_job = self._active_job_by_project.get(project_key)
            now = self._clock()
            if active_job is not None:
                active_job_id, lease_expires_at = active_job
                if active_job_id != job_id or now < lease_expires_at:
                    raise ProjectBusyError
                self._active_job_by_project[project_key] = (
                    job_id,
                    now + self._lease_seconds,
                )
                return job
            if job_id in self._claimed_job_ids:
                return None
            self._claimed_job_ids.add(job_id)
            self._active_job_by_project[project_key] = (
                job_id,
                now + self._lease_seconds,
            )
            return job

    async def complete(self, job_id: str) -> bool:
        async with self._lock:
            if (
                job_id not in self._claimed_job_ids
                or job_id in self._completed_job_ids
                or job_id in self._failed_job_ids
            ):
                return False
            self._completed_job_ids.add(job_id)
            self._release_project(job_id)
            return True

    async def attach_progress(
        self,
        job_id: str,
        message: ProgressMessage,
    ) -> bool:
        async with self._lock:
            job = self._jobs.get(job_id)
            if (
                job is None
                or job_id not in self._claimed_job_ids
                or job_id in self._completed_job_ids
                or job_id in self._failed_job_ids
                or message.channel_id != job.channel_id
                or message.thread_ts != job.thread_ts
            ):
                return False
            existing = self._progress_by_job_id.get(job_id)
            if existing is not None:
                return existing == message
            self._progress_by_job_id[job_id] = message
            return True

    async def get_progress(self, job_id: str) -> ProgressMessage | None:
        async with self._lock:
            return self._progress_by_job_id.get(job_id)

    async def release(self, job_id: str, *, reason: JobRetryReason) -> bool:
        JobRetryReason(reason)
        async with self._lock:
            if (
                job_id not in self._claimed_job_ids
                or job_id in self._completed_job_ids
                or job_id in self._failed_job_ids
            ):
                return False
            self._claimed_job_ids.remove(job_id)
            self._release_project(job_id)
            return True

    async def fail(self, job_id: str, *, reason: JobFailureReason) -> bool:
        JobFailureReason(reason)
        async with self._lock:
            if (
                job_id not in self._claimed_job_ids
                or job_id in self._completed_job_ids
                or job_id in self._failed_job_ids
            ):
                return False
            self._failed_job_ids.add(job_id)
            self._release_project(job_id)
            return True

    def _release_project(self, job_id: str) -> None:
        job = self._jobs[job_id]
        project_key = (job.workspace_id, job.channel_id)
        active_job = self._active_job_by_project.get(project_key)
        if active_job is not None and active_job[0] == job_id:
            del self._active_job_by_project[project_key]

    def list_jobs(self) -> list[DurableSlackJob]:
        return list(self._jobs.values())


class InMemoryTaskDispatcher:
    def __init__(self) -> None:
        self._job_ids: dict[str, None] = {}
        self._lock = asyncio.Lock()

    async def dispatch(self, job: DurableSlackJob) -> None:
        async with self._lock:
            self._job_ids.setdefault(job.job_id, None)

    def dispatched_job_ids(self) -> list[str]:
        return list(self._job_ids)


class _CallableClock(Clock):
    def __init__(self, now: Callable[[], float]) -> None:
        self._now = now

    def now(self) -> float:
        return self._now()


def _is_onboarding_request(text: str) -> bool:
    command = _slack_command(text).casefold()
    return command == "onboard project" or command.startswith("onboard project ")


def _is_feature_request(text: str) -> bool:
    command = _slack_command(text).casefold()
    return command.startswith("test ") and len(command) > len("test ")


def _finding_id(text: str) -> str | None:
    command = _slack_command(text).casefold()
    match = re.fullmatch(r"explain\s+(finding-[0-9a-f]{16})", command)
    return None if match is None else match.group(1)


def _slack_command(text: str) -> str:
    return re.sub(r"^\s*<@[^>]+>\s*", "", text).strip()


def _feature_job(event: _SlackEvent, envelope: _SlackEnvelope) -> DurableSlackJob:
    from app.feature_worker_job import FeatureTestJob

    command = _slack_command(event.text).casefold()
    run_digest = hashlib.sha256(envelope.event_id.encode()).hexdigest()
    feature_digest = hashlib.sha256(command.encode()).hexdigest()
    return FeatureTestJob(
        job_id=f"slack:{envelope.event_id}",
        source_event_id=envelope.event_id,
        project_id=project_id_for_channel(envelope.team_id, event.channel),
        workspace_id=envelope.team_id,
        channel_id=event.channel,
        requester_user_id=event.user,
        thread_ts=event.ts,
        run_id=f"run-{run_digest[:24]}",
        feature_slug=f"feature-{feature_digest[:16]}",
        request_text=event.text,
    )


def _finding_job(
    event: _SlackEvent,
    envelope: _SlackEnvelope,
    finding_id: str,
) -> DurableSlackJob:
    from app.finding_follow_up import ExplainFindingJob

    return ExplainFindingJob(
        job_id=f"slack:{envelope.event_id}",
        source_event_id=envelope.event_id,
        project_id=project_id_for_channel(envelope.team_id, event.channel),
        workspace_id=envelope.team_id,
        channel_id=event.channel,
        requester_user_id=event.user,
        thread_ts=event.ts,
        finding_id=finding_id,
        request_text=event.text,
    )


def create_slack_router(
    *,
    settings: SlackIngressSettings,
    jobs: JobRepository,
    tasks: TaskDispatcher,
    feature_tasks: TaskDispatcher | None = None,
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

        finding_id = _finding_id(event.text)
        if finding_id is not None:
            if feature_tasks is None:
                return {"ok": True}
            finding_job = _finding_job(event, envelope, finding_id)
            await jobs.create(finding_job)
            await feature_tasks.dispatch(finding_job)
            return {"ok": True}

        if _is_feature_request(event.text):
            if feature_tasks is None:
                return {"ok": True}
            feature_job = _feature_job(event, envelope)
            await jobs.create(feature_job)
            await feature_tasks.dispatch(feature_job)
            return {"ok": True}

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
            files=event.files,
        )
        await jobs.create(job)
        await tasks.dispatch(job)
        return {"ok": True}

    return router


__all__ = [
    "InMemoryJobRepository",
    "InMemoryTaskDispatcher",
    "JobRepository",
    "OnboardProjectJob",
    "SlackFileReference",
    "SlackIngressSettings",
    "TaskDispatcher",
    "create_slack_router",
]
