from __future__ import annotations

import asyncio
import re
import uuid
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.browser_executor_agent import BrowserScenarioResult
from app.failure_investigation import FailureInvestigationResult
from app.run_artifacts import FeatureRunRecord, RunArtifactDocument
from app.slack_feature_results import SlackFeatureResult, render_finding_follow_up
from app.test_design import TestPlan


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


class _PersistedScenario(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    scenario_id: str
    passed: bool
    step_count: int = Field(gt=0)
    evaluation: dict[str, Any]
    investigation: FailureInvestigationResult | None

    @model_validator(mode="after")
    def require_matching_evaluation(self) -> _PersistedScenario:
        result = BrowserScenarioResult(
            scenario_id=self.scenario_id,
            step_count=self.step_count,
            evaluation=self.evaluation,
        )
        if result.evaluation.passed != self.passed:
            raise ValueError("persisted scenario verdict does not match evaluation")
        return self

    def browser_result(self) -> BrowserScenarioResult:
        return BrowserScenarioResult(
            scenario_id=self.scenario_id,
            step_count=self.step_count,
            evaluation=self.evaluation,
        )


class _PersistedRunResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    run_id: str
    feature_slug: str
    feature_name: str
    scenario_count: int = Field(ge=1)
    check_count: int = Field(ge=1)
    passed_scenario_count: int = Field(ge=0)
    finding_ids: tuple[str, ...]
    scenarios: tuple[_PersistedScenario, ...] = Field(min_length=1)


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
        prefix = f"projects/{job.project_id}/runs/{run_id}"
        request_document, plan_document, result_document = await asyncio.gather(
            self._artifacts.read(f"{prefix}/request.md"),
            self._artifacts.read(f"{prefix}/plan.json"),
            self._artifacts.read(f"{prefix}/result.json"),
        )
        if (
            request_document.content_type != "text/markdown; charset=utf-8"
            or plan_document.content_type != "application/json"
            or result_document.content_type != "application/json"
        ):
            raise ValueError("finding source artifacts have unexpected content types")
        try:
            plan = TestPlan.model_validate_json(plan_document.content)
            persisted = _PersistedRunResult.model_validate_json(result_document.content)
            request_markdown = request_document.content.decode("utf-8").strip()
        except (UnicodeDecodeError, ValueError):
            raise ValueError("finding source artifacts are invalid") from None
        if (
            persisted.project_id != job.project_id
            or persisted.run_id != run_id
            or plan.project_id != job.project_id
            or persisted.feature_name != plan.feature_name
        ):
            raise ValueError("finding source artifacts do not match the requested run")
        record = FeatureRunRecord(
            project_id=persisted.project_id,
            run_id=persisted.run_id,
            feature_slug=persisted.feature_slug,
            request_markdown=request_markdown,
            plan=plan,
            scenario_results=tuple(
                scenario.browser_result() for scenario in persisted.scenarios
            ),
            investigations=tuple(
                scenario.investigation
                for scenario in persisted.scenarios
                if scenario.investigation is not None
            ),
        )
        actual_finding_ids = tuple(
            investigation.finding.finding_id
            for investigation in record.investigations
            if investigation.finding is not None
        )
        if (
            persisted.scenario_count != len(record.scenario_results)
            or persisted.check_count
            != sum(result.evaluation.check_count for result in record.scenario_results)
            or persisted.passed_scenario_count
            != sum(result.evaluation.passed for result in record.scenario_results)
            or persisted.finding_ids != actual_finding_ids
        ):
            raise ValueError("finding source artifact summary is inconsistent")
        return record


__all__ = [
    "ExplainFindingJob",
    "FindingFollowUpProcessor",
    "InMemoryFindingFollowUpPublisher",
    "PublishedFindingFollowUp",
    "SlackFindingFollowUpPublisher",
]
