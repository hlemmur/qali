import hashlib
import hmac
import json

import httpx
import pytest
from fastapi import FastAPI

from app.slack_ingress import (
    InMemoryJobRepository,
    InMemoryTaskDispatcher,
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
