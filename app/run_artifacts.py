from __future__ import annotations

import hashlib
import json
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.browser_executor_agent import BrowserScenarioResult
from app.failure_investigation import (
    FailureFinding,
    FailureInvestigationResult,
)
from app.test_design import TestPlan, TestScenario

_RESOURCE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")


class FeatureRunRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    run_id: str = Field(min_length=1, max_length=128)
    feature_slug: str = Field(min_length=1, max_length=128)
    request_markdown: str = Field(min_length=1, max_length=20_000)
    plan: TestPlan
    scenario_results: tuple[BrowserScenarioResult, ...] = Field(
        min_length=1,
        max_length=100,
    )
    investigations: tuple[FailureInvestigationResult, ...] = Field(max_length=100)

    @field_validator("project_id", "run_id", "feature_slug")
    @classmethod
    def require_safe_resource_id(cls, value: str) -> str:
        if _RESOURCE_ID.fullmatch(value) is None:
            raise ValueError("artifact resource identifier is unsafe")
        return value

    @model_validator(mode="after")
    def require_complete_scenario_accounting(self) -> FeatureRunRecord:
        if self.plan.project_id != self.project_id:
            raise ValueError("run and plan project scopes do not match")
        planned_ids = [scenario.scenario_id for scenario in self.plan.scenarios]
        result_ids = [result.scenario_id for result in self.scenario_results]
        if len(result_ids) != len(set(result_ids)) or set(result_ids) != set(
            planned_ids
        ):
            raise ValueError("run requires exactly one result for every scenario")

        failed_ids = {
            result.scenario_id
            for result in self.scenario_results
            if not result.evaluation.passed
        }
        investigation_ids = [
            result.reproduction_attempt.result.scenario_id
            for result in self.investigations
        ]
        if (
            len(investigation_ids) != len(set(investigation_ids))
            or set(investigation_ids) != failed_ids
        ):
            raise ValueError("every failed scenario requires one investigation")
        initial_by_scenario = {
            investigation.initial_attempt.result.scenario_id: investigation.initial_attempt.result
            for investigation in self.investigations
        }
        result_by_scenario = {
            result.scenario_id: result for result in self.scenario_results
        }
        if any(
            initial_by_scenario[scenario_id] != result_by_scenario[scenario_id]
            for scenario_id in failed_ids
        ):
            raise ValueError("investigation must originate from the recorded failure")
        return self


class RunArtifactDocument(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    object_name: str = Field(min_length=1, max_length=1_024)
    content_type: str = Field(min_length=1, max_length=100)
    content: bytes = Field(min_length=1, max_length=1_000_000)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def require_matching_hash(self) -> RunArtifactDocument:
        if hashlib.sha256(self.content).hexdigest() != self.sha256:
            raise ValueError("artifact content hash does not match")
        return self


class FeatureRunArtifactBundle(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    run_id: str
    documents: tuple[RunArtifactDocument, ...] = Field(min_length=4, max_length=104)

    @field_validator("project_id", "run_id")
    @classmethod
    def require_safe_resource_id(cls, value: str) -> str:
        if _RESOURCE_ID.fullmatch(value) is None:
            raise ValueError("artifact resource identifier is unsafe")
        return value

    @field_validator("documents")
    @classmethod
    def require_distinct_paths(
        cls,
        value: tuple[RunArtifactDocument, ...],
    ) -> tuple[RunArtifactDocument, ...]:
        paths = [document.object_name for document in value]
        if len(paths) != len(set(paths)):
            raise ValueError("artifact document paths must be distinct")
        return value

    @model_validator(mode="after")
    def require_planned_storage_layout(self) -> FeatureRunArtifactBundle:
        run_prefix = f"projects/{self.project_id}/runs/{self.run_id}"
        required = {
            f"{run_prefix}/request.md",
            f"{run_prefix}/plan.json",
            f"{run_prefix}/result.json",
            f"{run_prefix}/report.md",
        }
        paths = {document.object_name for document in self.documents}
        issue_pattern = re.compile(
            rf"^projects/{re.escape(self.project_id)}/issues/"
            r"finding-[0-9a-f]{16}\.md$"
        )
        if not required.issubset(paths) or any(
            path not in required and issue_pattern.fullmatch(path) is None
            for path in paths
        ):
            raise ValueError("artifact path is outside the planned storage layout")
        return self

    def document(self, object_name: str) -> RunArtifactDocument:
        for document in self.documents:
            if document.object_name == object_name:
                return document
        raise KeyError(object_name)


def compile_feature_run_artifacts(record: FeatureRunRecord) -> FeatureRunArtifactBundle:
    run_prefix = f"projects/{record.project_id}/runs/{record.run_id}"
    scenarios_by_id = {
        scenario.scenario_id: scenario for scenario in record.plan.scenarios
    }
    findings = tuple(
        investigation.finding
        for investigation in record.investigations
        if investigation.finding is not None
    )
    documents = [
        _document(
            f"{run_prefix}/request.md",
            record.request_markdown.rstrip() + "\n",
            "text/markdown; charset=utf-8",
        ),
        _json_document(f"{run_prefix}/plan.json", record.plan.model_dump(mode="json")),
        _json_document(f"{run_prefix}/result.json", _result_payload(record, findings)),
        _document(
            f"{run_prefix}/report.md",
            _report_markdown(record, findings),
            "text/markdown; charset=utf-8",
        ),
    ]
    documents.extend(
        _document(
            f"projects/{record.project_id}/issues/{finding.finding_id}.md",
            _finding_markdown(finding, scenarios_by_id[finding.scenario_id]),
            "text/markdown; charset=utf-8",
        )
        for finding in findings
    )
    return FeatureRunArtifactBundle(
        project_id=record.project_id,
        run_id=record.run_id,
        documents=tuple(documents),
    )


def _result_payload(
    record: FeatureRunRecord,
    findings: tuple[FailureFinding, ...],
) -> dict[str, object]:
    return {
        "project_id": record.project_id,
        "run_id": record.run_id,
        "feature_slug": record.feature_slug,
        "feature_name": record.plan.feature_name,
        "scenario_count": len(record.scenario_results),
        "check_count": sum(
            result.evaluation.check_count for result in record.scenario_results
        ),
        "passed_scenario_count": sum(
            result.evaluation.passed for result in record.scenario_results
        ),
        "finding_ids": [finding.finding_id for finding in findings],
        "scenarios": [
            {
                "scenario_id": result.scenario_id,
                "passed": result.evaluation.passed,
                "step_count": result.step_count,
                "evaluation": result.evaluation.model_dump(mode="json"),
                "investigation": next(
                    (
                        investigation.model_dump(mode="json")
                        for investigation in record.investigations
                        if investigation.reproduction_attempt.result.scenario_id
                        == result.scenario_id
                    ),
                    None,
                ),
            }
            for result in record.scenario_results
        ],
    }


def _report_markdown(
    record: FeatureRunRecord,
    findings: tuple[FailureFinding, ...],
) -> str:
    scenario_count = len(record.scenario_results)
    check_count = sum(
        result.evaluation.check_count for result in record.scenario_results
    )
    passed_count = sum(result.evaluation.passed for result in record.scenario_results)
    scenario_word = "scenario" if scenario_count == 1 else "scenarios"
    if passed_count == scenario_count:
        return (
            "# Qali feature test result\n\n"
            f"{record.plan.feature_name}: {scenario_count} {scenario_word} passed "
            f"({check_count} checks).\n"
        )

    lines = [
        "# Qali feature test result",
        "",
        f"{record.plan.feature_name}: {passed_count}/{scenario_count} scenarios passed "
        f"({check_count} checks).",
        "",
        "## Findings",
        "",
    ]
    if findings:
        lines.extend(
            f"- `{finding.finding_id}` — {finding.summary}" for finding in findings
        )
    else:
        lines.append(
            "- No confirmed finding; see the structured result for triage status."
        )
    return "\n".join(lines) + "\n"


def _finding_markdown(finding: FailureFinding, scenario: TestScenario) -> str:
    steps = (*scenario.setup, scenario.user_intent)
    lines = [
        f"# {finding.finding_id}",
        "",
        finding.summary,
        "",
        f"- Classification: `{finding.classification.value}`",
        f"- Scenario: `{finding.scenario_id}`",
        f"- Fingerprint: `{finding.fingerprint}`",
        "",
        "## Steps to reproduce",
        "",
        *(f"{index}. {_markdown_text(step)}" for index, step in enumerate(steps, 1)),
        "",
        "## Expected and actual behavior",
        "",
    ]
    for check in finding.failed_checks:
        lines.extend(
            (
                f"### `{check.oracle_id}`",
                "",
                f"- Expected: `{_inline_value(check.expected)}`",
                f"- Actual: `{_inline_value(check.actual)}`",
                "",
            )
        )
    lines.extend(("## Evidence", ""))
    lines.extend(
        f"- `{_inline_value(reference)}`" for reference in finding.evidence_refs
    )
    lines.extend(("", "## Traceability", ""))
    lines.extend(f"- `{_inline_value(reference)}`" for reference in finding.trace_refs)
    return "\n".join(lines) + "\n"


def _markdown_text(value: str) -> str:
    return " ".join(value.split())


def _inline_value(value: object) -> str:
    rendered = json.dumps(value, ensure_ascii=False) if value is not None else "null"
    if isinstance(value, str):
        rendered = value
    return _markdown_text(rendered).replace("`", "\\`")


def _json_document(object_name: str, payload: object) -> RunArtifactDocument:
    return _document(
        object_name,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        "application/json",
    )


def _document(
    object_name: str,
    content: str,
    content_type: str,
) -> RunArtifactDocument:
    encoded = content.encode("utf-8")
    return RunArtifactDocument(
        object_name=object_name,
        content_type=content_type,
        content=encoded,
        sha256=hashlib.sha256(encoded).hexdigest(),
    )


__all__ = [
    "FeatureRunArtifactBundle",
    "FeatureRunRecord",
    "RunArtifactDocument",
    "compile_feature_run_artifacts",
]
