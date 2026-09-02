from typing import Any

import pytest

from app.slack_ingress import OnboardProjectJob
from app.slack_progress import (
    InMemorySlackProgressReporter,
    OnboardingProgressStage,
    SlackProgressReporter,
)


class _RecordingSlackClient:
    def __init__(self) -> None:
        self.posts: list[dict[str, Any]] = []
        self.updates: list[dict[str, Any]] = []

    async def chat_postMessage(self, **kwargs: Any) -> dict[str, Any]:
        self.posts.append(kwargs)
        return {"ok": True, "ts": "1788220801.030000"}

    async def chat_update(self, **kwargs: Any) -> dict[str, Any]:
        self.updates.append(kwargs)
        return {"ok": True, "ts": kwargs["ts"]}


@pytest.mark.asyncio
async def test_onboarding_progress_posts_once_then_updates_same_thread_message() -> (
    None
):
    client = _RecordingSlackClient()
    reporter = SlackProgressReporter(client=client)
    job = OnboardProjectJob(
        job_id="slack:Ev-progress",
        source_event_id="Ev-progress",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.030000",
        request_text="<@U-QALI> onboard project Example",
    )

    message = await reporter.start(job)
    await reporter.update(message, OnboardingProgressStage.REVIEWING_SOURCES)

    assert client.posts == [
        {
            "channel": "C-QALI",
            "thread_ts": "1788220800.030000",
            "text": "Onboarding: request received.",
            "unfurl_links": False,
            "unfurl_media": False,
        }
    ]
    assert client.updates == [
        {
            "channel": "C-QALI",
            "ts": "1788220801.030000",
            "text": "Onboarding: reviewing project sources.",
        }
    ]
    assert message.channel_id == job.channel_id
    assert message.thread_ts == job.thread_ts
    assert message.message_ts == "1788220801.030000"


@pytest.mark.asyncio
async def test_mock_progress_reporter_exposes_one_updated_message() -> None:
    reporter = InMemorySlackProgressReporter()
    job = OnboardProjectJob(
        job_id="slack:Ev-mock-progress",
        source_event_id="Ev-mock-progress",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.031000",
        request_text="<@U-QALI> onboard project Example",
    )

    message = await reporter.start(job)
    await reporter.update(message, OnboardingProgressStage.READY)

    assert [record.model_dump(mode="json") for record in reporter.list_messages()] == [
        {
            "message": {
                "channel_id": "C-QALI",
                "thread_ts": "1788220800.031000",
                "message_ts": "mock-progress-1",
            },
            "stage": "ready",
            "badge": "MOCK MODE",
        }
    ]
