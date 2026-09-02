import hashlib
import hmac
import json

import httpx
import pytest
from fastapi import FastAPI

from app.job_lifecycle import JobFailureReason, JobRetryReason
from app.slack_ingress import (
    InMemoryJobRepository,
    InMemoryTaskDispatcher,
    OnboardProjectJob,
    SlackIngressSettings,
    create_slack_router,
)


def _signed_headers(body: bytes, timestamp: int, secret: str) -> dict[str, str]:
    base = b"v0:" + str(timestamp).encode() + b":" + body
    digest = hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
    return {
        "content-type": "application/json",
        "x-slack-request-timestamp": str(timestamp),
        "x-slack-signature": f"v0={digest}",
    }


class _FailOnceTaskDispatcher:
    def __init__(self) -> None:
        self.attempts = 0
        self.dispatched_job_ids: list[str] = []

    async def dispatch(self, job: OnboardProjectJob) -> None:
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("temporary task service failure")
        self.dispatched_job_ids.append(job.job_id)


@pytest.mark.asyncio
async def test_mock_job_repository_claims_pending_job_once() -> None:
    jobs = InMemoryJobRepository()
    job = OnboardProjectJob(
        job_id="slack:Ev-mock-claim",
        source_event_id="Ev-mock-claim",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.009000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)

    claimed = await jobs.claim(job.job_id)
    duplicate_claim = await jobs.claim(job.job_id)

    assert claimed == job
    assert duplicate_claim is None


@pytest.mark.asyncio
async def test_mock_job_repository_releases_retry_and_completes_once() -> None:
    jobs = InMemoryJobRepository()
    job = OnboardProjectJob(
        job_id="slack:Ev-mock-lifecycle",
        source_event_id="Ev-mock-lifecycle",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.012000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    await jobs.claim(job.job_id)

    released = await jobs.release(
        job.job_id,
        reason=JobRetryReason.PROCESSOR_ERROR,
    )
    reclaimed = await jobs.claim(job.job_id)
    completed = await jobs.complete(job.job_id)
    duplicate_completion = await jobs.complete(job.job_id)

    assert released is True
    assert reclaimed == job
    assert completed is True
    assert duplicate_completion is False


@pytest.mark.asyncio
async def test_mock_job_repository_terminal_failure_cannot_transition_again() -> None:
    jobs = InMemoryJobRepository()
    job = OnboardProjectJob(
        job_id="slack:Ev-mock-failed",
        source_event_id="Ev-mock-failed",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.018000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    await jobs.claim(job.job_id)

    failed = await jobs.fail(
        job.job_id,
        reason=JobFailureReason.RETRY_EXHAUSTED,
    )

    assert failed is True
    assert (
        await jobs.fail(
            job.job_id,
            reason=JobFailureReason.RETRY_EXHAUSTED,
        )
        is False
    )
    assert await jobs.claim(job.job_id) is None
    assert await jobs.complete(job.job_id) is False
    assert (
        await jobs.release(
            job.job_id,
            reason=JobRetryReason.PROCESSOR_ERROR,
        )
        is False
    )


@pytest.mark.asyncio
async def test_valid_onboarding_mention_creates_and_dispatches_job() -> None:
    now = 1_788_220_800
    secret = "test-signing-secret"
    jobs = InMemoryJobRepository()
    tasks = InMemoryTaskDispatcher()
    settings = SlackIngressSettings(
        signing_secret=secret,
        workspace_id="T-QALI",
        channel_id="C-QALI",
        owner_user_id="U-OWNER",
    )
    app = FastAPI()
    app.include_router(
        create_slack_router(
            settings=settings,
            jobs=jobs,
            tasks=tasks,
            clock=lambda: now,
        )
    )
    payload = {
        "type": "event_callback",
        "team_id": "T-QALI",
        "event_id": "Ev-001",
        "event": {
            "type": "app_mention",
            "user": "U-OWNER",
            "channel": "C-QALI",
            "ts": "1788220800.001000",
            "text": "<@U-QALI> onboard project Example",
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        response = await client.post(
            "/slack/events",
            content=body,
            headers=_signed_headers(body, now, secret),
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert [job.model_dump() for job in jobs.list_jobs()] == [
        {
            "job_id": "slack:Ev-001",
            "kind": "onboard_project",
            "source_event_id": "Ev-001",
            "workspace_id": "T-QALI",
            "channel_id": "C-QALI",
            "requester_user_id": "U-OWNER",
            "thread_ts": "1788220800.001000",
            "request_text": "<@U-QALI> onboard project Example",
        }
    ]
    assert tasks.dispatched_job_ids() == ["slack:Ev-001"]


@pytest.mark.asyncio
async def test_duplicate_event_delivery_dispatches_exactly_once() -> None:
    now = 1_788_220_800
    secret = "test-signing-secret"
    jobs = InMemoryJobRepository()
    tasks = InMemoryTaskDispatcher()
    app = FastAPI()
    app.include_router(
        create_slack_router(
            settings=SlackIngressSettings(
                signing_secret=secret,
                workspace_id="T-QALI",
                channel_id="C-QALI",
                owner_user_id="U-OWNER",
            ),
            jobs=jobs,
            tasks=tasks,
            clock=lambda: now,
        )
    )
    payload = {
        "type": "event_callback",
        "team_id": "T-QALI",
        "event_id": "Ev-duplicate",
        "event": {
            "type": "app_mention",
            "user": "U-OWNER",
            "channel": "C-QALI",
            "ts": "1788220800.002000",
            "text": "<@U-QALI> onboard project Example",
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode()
    headers = _signed_headers(body, now, secret)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        first = await client.post("/slack/events", content=body, headers=headers)
        second = await client.post("/slack/events", content=body, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert [job.job_id for job in jobs.list_jobs()] == ["slack:Ev-duplicate"]
    assert tasks.dispatched_job_ids() == ["slack:Ev-duplicate"]


@pytest.mark.asyncio
async def test_retry_dispatches_job_after_transient_task_failure() -> None:
    now = 1_788_220_800
    secret = "test-signing-secret"
    jobs = InMemoryJobRepository()
    tasks = _FailOnceTaskDispatcher()
    app = FastAPI()
    app.include_router(
        create_slack_router(
            settings=SlackIngressSettings(
                signing_secret=secret,
                workspace_id="T-QALI",
                channel_id="C-QALI",
                owner_user_id="U-OWNER",
            ),
            jobs=jobs,
            tasks=tasks,
            clock=lambda: now,
        )
    )
    payload = {
        "type": "event_callback",
        "team_id": "T-QALI",
        "event_id": "Ev-retry",
        "event": {
            "type": "app_mention",
            "user": "U-OWNER",
            "channel": "C-QALI",
            "ts": "1788220800.002500",
            "text": "<@U-QALI> onboard project Example",
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode()
    headers = _signed_headers(body, now, secret)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        with pytest.raises(RuntimeError, match="temporary task service failure"):
            await client.post("/slack/events", content=body, headers=headers)
        retry = await client.post("/slack/events", content=body, headers=headers)

    assert retry.status_code == 200
    assert [job.job_id for job in jobs.list_jobs()] == ["slack:Ev-retry"]
    assert tasks.attempts == 2
    assert tasks.dispatched_job_ids == ["slack:Ev-retry"]


@pytest.mark.asyncio
async def test_non_onboarding_mention_is_acknowledged_without_dispatch() -> None:
    now = 1_788_220_800
    secret = "test-signing-secret"
    jobs = InMemoryJobRepository()
    tasks = InMemoryTaskDispatcher()
    app = FastAPI()
    app.include_router(
        create_slack_router(
            settings=SlackIngressSettings(
                signing_secret=secret,
                workspace_id="T-QALI",
                channel_id="C-QALI",
                owner_user_id="U-OWNER",
            ),
            jobs=jobs,
            tasks=tasks,
            clock=lambda: now,
        )
    )
    payload = {
        "type": "event_callback",
        "team_id": "T-QALI",
        "event_id": "Ev-help",
        "event": {
            "type": "app_mention",
            "user": "U-OWNER",
            "channel": "C-QALI",
            "ts": "1788220800.003000",
            "text": "<@U-QALI> help",
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        response = await client.post(
            "/slack/events",
            content=body,
            headers=_signed_headers(body, now, secret),
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert jobs.list_jobs() == []
    assert tasks.dispatched_job_ids() == []


@pytest.mark.asyncio
async def test_signed_url_verification_returns_challenge() -> None:
    now = 1_788_220_800
    secret = "test-signing-secret"
    jobs = InMemoryJobRepository()
    tasks = InMemoryTaskDispatcher()
    app = FastAPI()
    app.include_router(
        create_slack_router(
            settings=SlackIngressSettings(
                signing_secret=secret,
                workspace_id="T-QALI",
                channel_id="C-QALI",
                owner_user_id="U-OWNER",
            ),
            jobs=jobs,
            tasks=tasks,
            clock=lambda: now,
        )
    )
    body = json.dumps(
        {
            "type": "url_verification",
            "token": "deprecated-verification-token",
            "challenge": "challenge-token",
        },
        separators=(",", ":"),
    ).encode()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        response = await client.post(
            "/slack/events",
            content=body,
            headers=_signed_headers(body, now, secret),
        )

    assert response.status_code == 200
    assert response.json() == {"challenge": "challenge-token"}
    assert jobs.list_jobs() == []
    assert tasks.dispatched_job_ids() == []


@pytest.mark.asyncio
async def test_unverifiable_slack_requests_are_rejected() -> None:
    now = 1_788_220_800
    secret = "test-signing-secret"
    jobs = InMemoryJobRepository()
    tasks = InMemoryTaskDispatcher()
    app = FastAPI()
    app.include_router(
        create_slack_router(
            settings=SlackIngressSettings(
                signing_secret=secret,
                workspace_id="T-QALI",
                channel_id="C-QALI",
                owner_user_id="U-OWNER",
            ),
            jobs=jobs,
            tasks=tasks,
            clock=lambda: now,
        )
    )
    payload = {
        "type": "event_callback",
        "team_id": "T-QALI",
        "event_id": "Ev-unverified",
        "event": {
            "type": "app_mention",
            "user": "U-OWNER",
            "channel": "C-QALI",
            "ts": "1788220800.004000",
            "text": "<@U-QALI> onboard project Example",
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        invalid_signature = await client.post(
            "/slack/events",
            content=body,
            headers=_signed_headers(body, now, "wrong-secret"),
        )
        stale_timestamp = now - 301
        replayed_request = await client.post(
            "/slack/events",
            content=body,
            headers=_signed_headers(body, stale_timestamp, secret),
        )

    assert invalid_signature.status_code == 401
    assert replayed_request.status_code == 401
    assert jobs.list_jobs() == []
    assert tasks.dispatched_job_ids() == []


@pytest.mark.asyncio
async def test_events_outside_private_qali_scope_are_rejected() -> None:
    now = 1_788_220_800
    secret = "test-signing-secret"
    jobs = InMemoryJobRepository()
    tasks = InMemoryTaskDispatcher()
    app = FastAPI()
    app.include_router(
        create_slack_router(
            settings=SlackIngressSettings(
                signing_secret=secret,
                workspace_id="T-QALI",
                channel_id="C-QALI",
                owner_user_id="U-OWNER",
            ),
            jobs=jobs,
            tasks=tasks,
            clock=lambda: now,
        )
    )
    unauthorized_events = [
        ("T-OTHER", "C-QALI", "U-OWNER"),
        ("T-QALI", "C-OTHER", "U-OWNER"),
        ("T-QALI", "C-QALI", "U-OTHER"),
    ]

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        responses = []
        for index, (workspace_id, channel_id, user_id) in enumerate(
            unauthorized_events
        ):
            payload = {
                "type": "event_callback",
                "team_id": workspace_id,
                "event_id": f"Ev-unauthorized-{index}",
                "event": {
                    "type": "app_mention",
                    "user": user_id,
                    "channel": channel_id,
                    "ts": f"1788220800.00{index + 5}000",
                    "text": "<@U-QALI> onboard project Example",
                },
            }
            body = json.dumps(payload, separators=(",", ":")).encode()
            responses.append(
                await client.post(
                    "/slack/events",
                    content=body,
                    headers=_signed_headers(body, now, secret),
                )
            )

    assert [response.status_code for response in responses] == [403, 403, 403]
    assert jobs.list_jobs() == []
    assert tasks.dispatched_job_ids() == []
