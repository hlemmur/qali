from __future__ import annotations

import asyncio
from enum import StrEnum
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field
from slack_sdk.web.async_client import AsyncWebClient

from app.slack_ingress import OnboardProjectJob


class OnboardingProgressStage(StrEnum):
    RECEIVED = "received"
    REVIEWING_SOURCES = "reviewing_sources"
    COMPILING_KNOWLEDGE = "compiling_knowledge"
    REVIEWING_KNOWLEDGE = "reviewing_knowledge"
    READY = "ready"
    INSUFFICIENT_KNOWLEDGE = "insufficient_knowledge"
    FAILED = "failed"


_STAGE_TEXT = {
    OnboardingProgressStage.RECEIVED: "Onboarding: request received.",
    OnboardingProgressStage.REVIEWING_SOURCES: (
        "Onboarding: reviewing project sources."
    ),
    OnboardingProgressStage.COMPILING_KNOWLEDGE: (
        "Onboarding: compiling project knowledge."
    ),
    OnboardingProgressStage.REVIEWING_KNOWLEDGE: (
        "Onboarding: checking knowledge quality."
    ),
    OnboardingProgressStage.READY: "Onboarding complete: project is ready.",
    OnboardingProgressStage.INSUFFICIENT_KNOWLEDGE: (
        "Onboarding paused: more project information is needed."
    ),
    OnboardingProgressStage.FAILED: (
        "Onboarding failed. Please try again or review the project setup."
    ),
}


class ProgressMessage(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    channel_id: str = Field(min_length=1)
    thread_ts: str = Field(min_length=1)
    message_ts: str = Field(min_length=1)


class MockProgressRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    message: ProgressMessage
    stage: OnboardingProgressStage
    badge: Literal["MOCK MODE"] = "MOCK MODE"


class SlackProgressClient(Protocol):
    async def chat_postMessage(
        self,
        *,
        channel: str,
        thread_ts: str,
        text: str,
        unfurl_links: bool,
        unfurl_media: bool,
    ) -> Any: ...

    async def chat_update(
        self,
        *,
        channel: str,
        ts: str,
        text: str,
    ) -> Any: ...


class SlackProgressReporter:
    def __init__(self, *, client: SlackProgressClient) -> None:
        self._client = client

    async def start(self, job: OnboardProjectJob) -> ProgressMessage:
        response = await self._client.chat_postMessage(
            channel=job.channel_id,
            thread_ts=job.thread_ts,
            text=_STAGE_TEXT[OnboardingProgressStage.RECEIVED],
            unfurl_links=False,
            unfurl_media=False,
        )
        message_ts = response.get("ts")
        if not isinstance(message_ts, str) or not message_ts:
            raise RuntimeError("Slack did not return a progress message timestamp")
        return ProgressMessage(
            channel_id=job.channel_id,
            thread_ts=job.thread_ts,
            message_ts=message_ts,
        )

    async def update(
        self,
        message: ProgressMessage,
        stage: OnboardingProgressStage,
    ) -> None:
        stage = OnboardingProgressStage(stage)
        await self._client.chat_update(
            channel=message.channel_id,
            ts=message.message_ts,
            text=_STAGE_TEXT[stage],
        )


class InMemorySlackProgressReporter:
    def __init__(self) -> None:
        self._records: dict[str, MockProgressRecord] = {}
        self._next_id = 1
        self._lock = asyncio.Lock()

    async def start(self, job: OnboardProjectJob) -> ProgressMessage:
        async with self._lock:
            message = ProgressMessage(
                channel_id=job.channel_id,
                thread_ts=job.thread_ts,
                message_ts=f"mock-progress-{self._next_id}",
            )
            self._next_id += 1
            self._records[message.message_ts] = MockProgressRecord(
                message=message,
                stage=OnboardingProgressStage.RECEIVED,
            )
            return message

    async def update(
        self,
        message: ProgressMessage,
        stage: OnboardingProgressStage,
    ) -> None:
        stage = OnboardingProgressStage(stage)
        async with self._lock:
            record = self._records.get(message.message_ts)
            if record is None or record.message != message:
                raise KeyError("unknown mock progress message")
            self._records[message.message_ts] = record.model_copy(
                update={"stage": stage}
            )

    def list_messages(self) -> list[MockProgressRecord]:
        return list(self._records.values())


def create_slack_progress_reporter(token: str) -> SlackProgressReporter:
    if not token.strip():
        raise ValueError("Slack bot token must not be empty")
    return SlackProgressReporter(client=AsyncWebClient(token=token))


__all__ = [
    "InMemorySlackProgressReporter",
    "MockProgressRecord",
    "OnboardingProgressStage",
    "ProgressMessage",
    "SlackProgressReporter",
    "create_slack_progress_reporter",
]
