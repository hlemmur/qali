from __future__ import annotations

import asyncio
import json
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.run_artifacts import FeatureRunRecord
from app.slack_progress import ProgressMessage

_MOCK_BADGE = "[MOCK MODE]"


class SlackFeatureResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    text: str = Field(min_length=1, max_length=35_000)
    mock_mode: bool


class SlackFeatureResultClient(Protocol):
    async def chat_update(
        self,
        *,
        channel: str,
        ts: str,
        text: str,
    ) -> Any: ...


class SlackFeatureResultPublisher:
    def __init__(self, *, client: SlackFeatureResultClient) -> None:
        self._client = client

    async def publish(
        self,
        message: ProgressMessage,
        result: SlackFeatureResult,
    ) -> None:
        await self._client.chat_update(
            channel=message.channel_id,
            ts=message.message_ts,
            text=result.text,
        )


class InMemorySlackFeatureResultPublisher:
    def __init__(self) -> None:
        self._messages: dict[str, tuple[ProgressMessage, SlackFeatureResult]] = {}
        self._lock = asyncio.Lock()

    async def publish(
        self,
        message: ProgressMessage,
        result: SlackFeatureResult,
    ) -> None:
        async with self._lock:
            self._messages[message.message_ts] = (message, result)

    def list_messages(self) -> list[tuple[ProgressMessage, SlackFeatureResult]]:
        return list(self._messages.values())


def render_feature_result(
    record: FeatureRunRecord,
    *,
    mock_mode: bool,
) -> SlackFeatureResult:
    scenario_count = len(record.scenario_results)
    check_count = sum(
        result.evaluation.check_count for result in record.scenario_results
    )
    passed_count = sum(result.evaluation.passed for result in record.scenario_results)
    if passed_count == scenario_count:
        scenario_word = "scenario" if scenario_count == 1 else "scenarios"
        text = (
            f"{_plain(record.plan.feature_name)}: {scenario_count} {scenario_word} "
            f"passed ({check_count} checks)."
        )
        return _rendered(text, mock_mode=mock_mode)

    lines = [
        f"{_plain(record.plan.feature_name)}: {passed_count}/{scenario_count} "
        f"scenarios passed ({check_count} checks)."
    ]
    findings = [
        investigation.finding
        for investigation in record.investigations
        if investigation.finding is not None
    ]
    if findings:
        finding_word = "finding" if len(findings) == 1 else "findings"
        lines.append(f"{len(findings)} {finding_word}:")
        lines.extend(
            f"• {finding.finding_id}: {_plain(finding.summary)}" for finding in findings
        )
    else:
        lines.append("No confirmed finding:")
        lines.extend(
            f"• {_plain(_scenario_title(record, investigation.initial_attempt.result.scenario_id))}: "
            f"{_plain(investigation.analysis.summary)}"
            for investigation in record.investigations
        )
    return _rendered("\n".join(lines), mock_mode=mock_mode)


def render_finding_follow_up(
    record: FeatureRunRecord,
    finding_id: str,
    *,
    mock_mode: bool,
) -> SlackFeatureResult:
    finding = next(
        (
            investigation.finding
            for investigation in record.investigations
            if investigation.finding is not None
            and investigation.finding.finding_id == finding_id
        ),
        None,
    )
    if finding is None:
        raise KeyError(finding_id)
    scenario = next(
        scenario
        for scenario in record.plan.scenarios
        if scenario.scenario_id == finding.scenario_id
    )
    steps = (*scenario.setup, scenario.user_intent)
    lines = [
        f"{finding.finding_id}: {_plain(finding.summary)}",
        "Repro:",
        *(f"{index}. {_plain(step)}" for index, step in enumerate(steps, 1)),
        "Expected / actual:",
    ]
    lines.extend(
        f"• {check.oracle_id} — Expected: {_value(check.expected)}; "
        f"Actual: {_value(check.actual)}"
        for check in finding.failed_checks
    )
    lines.append("Evidence:")
    lines.extend(f"• {_plain(reference)}" for reference in finding.evidence_refs)
    return _rendered("\n".join(lines), mock_mode=mock_mode)


def _scenario_title(record: FeatureRunRecord, scenario_id: str) -> str:
    return next(
        scenario.title
        for scenario in record.plan.scenarios
        if scenario.scenario_id == scenario_id
    )


def _value(value: object) -> str:
    if isinstance(value, str):
        return _plain(value)
    return _plain(json.dumps(value, ensure_ascii=False))


def _plain(value: str) -> str:
    return (
        " ".join(value.split())
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _rendered(text: str, *, mock_mode: bool) -> SlackFeatureResult:
    if mock_mode:
        text = f"{_MOCK_BADGE}\n{text}"
    return SlackFeatureResult(text=text, mock_mode=mock_mode)


__all__ = [
    "InMemorySlackFeatureResultPublisher",
    "SlackFeatureResult",
    "SlackFeatureResultPublisher",
    "render_feature_result",
    "render_finding_follow_up",
]
