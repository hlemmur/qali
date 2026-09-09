from __future__ import annotations

import asyncio
import re
import uuid
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.run_artifacts import FeatureRunRecord, RunArtifactDocument
from app.run_record_loader import FeatureRunRecordLoader
from app.slack_feature_results import SlackFeatureResult, render_finding_follow_up


class ExplainFindingJob(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    job_id: str = Field(min_length=1, max_length=256)
    kind: Literal["explain_finding"] = "explain_finding"
    source_event_id: str = Field(min_length=1, max_length=128)
    project_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    workspace_id: str = Field(min_length=1, max_length=128)
    channel_id: str = Field(min_length=1, max_length=128)
    requester_user_id: str = Field(min_length=1, max_length=128)
    thread_ts: str = Field(min_length=1, max_length=64)
    finding_id: str = Field(pattern=r"^finding-[0-9a-f]{16}$")
    request_text: str = Field(min_length=1, max_length=4_000)


class FindingArtifactReader(Protocol):
    async def read(self, object_name: str) -> RunArtifactDocument: ...

    async def resolve_finding_run(self, project_id: str, finding_id: str) -> str: ...


class FindingFollowUpClient(Protocol):
    async def chat_postMessage(
        self,
        *,
        channel: str,
        thread_ts: str,
        text: str,
        unfurl_links: bool,
        unfurl_media: bool,
        client_msg_id: str,
    ) -> Any: ...


class PublishedFindingFollowUp(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    channel_id: str
    thread_ts: str
    result: SlackFeatureResult


class SlackFindingFollowUpPublisher:
    def __init__(self, *, client: FindingFollowUpClient) -> None:
        self._client = client

    async def publish(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        result: SlackFeatureResult,
        idempotency_key: str,
    ) -> None:
        await self._client.chat_postMessage(
            channel=channel_id,
            thread_ts=thread_ts,
            text=result.text,
            unfurl_links=False,
            unfurl_media=False,
            client_msg_id=str(uuid.uuid5(uuid.NAMESPACE_URL, idempotency_key)),
        )


class InMemoryFindingFollowUpPublisher:
    def __init__(self) -> None:
        self._messages: list[PublishedFindingFollowUp] = []
        self._lock = asyncio.Lock()

    async def publish(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        result: SlackFeatureResult,
        idempotency_key: str,
    ) -> None:
        message = PublishedFindingFollowUp(
            channel_id=channel_id,
            thread_ts=thread_ts,
            result=result,
        )
        async with self._lock:
            if message not in self._messages:
                self._messages.append(message)

    def list_messages(self) -> list[PublishedFindingFollowUp]:
        return list(self._messages)


class FindingFollowUpPublisher(Protocol):
    async def publish(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        result: SlackFeatureResult,
        idempotency_key: str,
    ) -> None: ...


class FindingFollowUpProcessor:
    def __init__(
        self,
        *,
        artifacts: FindingArtifactReader,
        publisher: FindingFollowUpPublisher,
        mock_mode: bool,
    ) -> None:
        self._artifacts = artifacts
        self._publisher = publisher
        self._mock_mode = mock_mode

    async def process(self, job: ExplainFindingJob) -> None:
        record = await self._load_record(job)
        result = render_finding_follow_up(
            record,
            job.finding_id,
            mock_mode=self._mock_mode,
        )
        await self._publisher.publish(
            channel_id=job.channel_id,
            thread_ts=job.thread_ts,
            result=result,
            idempotency_key=job.job_id,
        )

    async def _load_record(self, job: ExplainFindingJob) -> FeatureRunRecord:
        run_id = await self._artifacts.resolve_finding_run(
            job.project_id,
            job.finding_id,
        )
        if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,127}", run_id) is None:
            raise ValueError("finding source returned an unsafe run identifier")
        return await FeatureRunRecordLoader(artifacts=self._artifacts).load(
            job.project_id,
            run_id,
        )


__all__ = [
    "ExplainFindingJob",
    "FindingFollowUpProcessor",
    "InMemoryFindingFollowUpPublisher",
    "PublishedFindingFollowUp",
    "SlackFindingFollowUpPublisher",
]
