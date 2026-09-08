from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.failure_investigation import FailureFinding
from app.run_artifacts import FeatureRunRecord, RunArtifactDocument


class FindingStatus(StrEnum):
    OPEN = "open"
    RESOLVED = "resolved"


class FindingProjectionState(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    finding_id: str = Field(pattern=r"^finding-[0-9a-f]{16}$")
    status: FindingStatus


class ProjectRunAuditEvent(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    record: FeatureRunRecord
    completed_at: datetime

    @field_validator("completed_at")
    @classmethod
    def require_aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("run completion time must be timezone-aware")
        return value.astimezone(UTC)


class ProjectProjectionBundle(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    documents: tuple[RunArtifactDocument, RunArtifactDocument]

    @model_validator(mode="after")
    def require_projection_paths(self) -> ProjectProjectionBundle:
        expected = (
            f"projects/{self.project_id}/logs/testing-log.md",
            f"projects/{self.project_id}/issues/index.md",
        )
        if tuple(document.object_name for document in self.documents) != expected:
            raise ValueError("project projection paths do not match project scope")
        return self

    def document(self, object_name: str) -> RunArtifactDocument:
        for document in self.documents:
            if document.object_name == object_name:
                return document
        raise KeyError(object_name)


def compile_project_projections(
    events: tuple[ProjectRunAuditEvent, ...],
    *,
    finding_states: tuple[FindingProjectionState, ...] = (),
) -> ProjectProjectionBundle:
    if not events:
        raise ValueError("at least one run audit event is required")
    project_ids = {event.record.project_id for event in events}
    if len(project_ids) != 1:
        raise ValueError("project projections require events from one project")
    run_ids = [event.record.run_id for event in events]
    if len(run_ids) != len(set(run_ids)):
        raise ValueError("project projections require one event per run")

    state_by_finding = {state.finding_id: state.status for state in finding_states}
    if len(state_by_finding) != len(finding_states):
        raise ValueError("finding projection states must be distinct")

    ordered = tuple(
        sorted(events, key=lambda item: (item.completed_at, item.record.run_id))
    )
    findings = _latest_findings(ordered)
    unknown_states = set(state_by_finding) - set(findings)
    if unknown_states:
        raise ValueError("finding status references an unknown finding")

    project_id = next(iter(project_ids))
    return ProjectProjectionBundle(
        project_id=project_id,
        documents=(
            _document(
                f"projects/{project_id}/logs/testing-log.md",
                _testing_log(ordered),
            ),
            _document(
                f"projects/{project_id}/issues/index.md",
                _issue_index(findings, state_by_finding),
            ),
        ),
    )


def _testing_log(events: tuple[ProjectRunAuditEvent, ...]) -> str:
    lines = ["# Qali testing log", ""]
    for event in events:
        record = event.record
        scenario_count = len(record.scenario_results)
        check_count = sum(
            result.evaluation.check_count for result in record.scenario_results
        )
        passed_count = sum(
            result.evaluation.passed for result in record.scenario_results
        )
        finding_ids = [
            investigation.finding.finding_id
            for investigation in record.investigations
            if investigation.finding is not None
        ]
        finding_text = ", ".join(f"`{finding_id}`" for finding_id in finding_ids)
        lines.append(
            f"- `{_rfc3339(event.completed_at)}` — `{record.run_id}` — "
            f"{_plain(record.plan.feature_name)}: {passed_count}/{scenario_count} "
            f"scenarios passed ({check_count} checks). Findings: "
            f"{finding_text or 'none'}."
        )
    return "\n".join(lines) + "\n"


def _latest_findings(
    events: tuple[ProjectRunAuditEvent, ...],
) -> dict[str, tuple[FailureFinding, FeatureRunRecord]]:
    findings: dict[str, tuple[FailureFinding, FeatureRunRecord]] = {}
    for event in events:
        for investigation in event.record.investigations:
            if investigation.finding is not None:
                findings[investigation.finding.finding_id] = (
                    investigation.finding,
                    event.record,
                )
    return findings


def _issue_index(
    findings: dict[str, tuple[FailureFinding, FeatureRunRecord]],
    state_by_finding: dict[str, FindingStatus],
) -> str:
    lines = ["# Qali issue index", ""]
    for status in FindingStatus:
        lines.extend((f"## {status.value.title()}", ""))
        matching = [
            (finding_id, finding, record)
            for finding_id, (finding, record) in findings.items()
            if state_by_finding.get(finding_id, FindingStatus.OPEN) == status
        ]
        if not matching:
            lines.extend(("- None.", ""))
            continue
        for finding_id, finding, record in sorted(matching):
            lines.append(
                f"- [{status.value.upper()}] `{finding_id}` — "
                f"{_plain(finding.summary)} "
                f"({_plain(record.plan.feature_name)}; run `{record.run_id}`)"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _plain(value: str) -> str:
    return " ".join(value.split()).replace("`", "\\`")


def _rfc3339(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _document(object_name: str, content: str) -> RunArtifactDocument:
    encoded = content.encode("utf-8")
    return RunArtifactDocument(
        object_name=object_name,
        content_type="text/markdown; charset=utf-8",
        content=encoded,
        sha256=hashlib.sha256(encoded).hexdigest(),
    )


__all__ = [
    "FindingProjectionState",
    "FindingStatus",
    "ProjectProjectionBundle",
    "ProjectRunAuditEvent",
    "compile_project_projections",
]
