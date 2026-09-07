from __future__ import annotations

import hashlib
import json
import re
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.browser_executor_agent import BrowserExecutionTask, BrowserScenarioResult
from app.oracle_evaluation import OracleCheck, OracleCheckStatus

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_TIMESTAMP = re.compile(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b")
_UUID = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
_PROCESS_ID = re.compile(r"\bpid[=: ]\d+\b", re.IGNORECASE)
_PORT = re.compile(r":\d{4,5}(?=[\s/,)\]]|$)")
_TEMP_PATH = re.compile(r"/(?:tmp|private/tmp)/[^\s]+")
_MEMORY_ADDRESS = re.compile(r"\b0x[0-9a-f]{8,16}\b", re.IGNORECASE)
_REQUEST_ID = re.compile(
    r"\b(?:request[_-]?id|trace[_-]?id|correlation[_-]?id)"
    r"[=: ][\"']?[a-zA-Z0-9-]+",
    re.IGNORECASE,
)
_SOURCE_LINE = re.compile(r"(?P<file>\b[^\s:]+\.[a-zA-Z0-9]+):\d+(?::\d+)?")
_WHITESPACE = re.compile(r"\s+")


class FailureFingerprintInput(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    feature_slug: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    scenario_id: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    failed_checks: tuple[OracleCheck, ...] = Field(min_length=1, max_length=40)

    @field_validator("failed_checks")
    @classmethod
    def require_distinct_failed_checks(
        cls,
        value: tuple[OracleCheck, ...],
    ) -> tuple[OracleCheck, ...]:
        oracle_ids = [check.oracle_id for check in value]
        if any(check.status is not OracleCheckStatus.FAILED for check in value) or len(
            oracle_ids
        ) != len(set(oracle_ids)):
            raise ValueError("fingerprint input requires distinct failed checks")
        return value


class FailureClassification(StrEnum):
    PRODUCT_DEFECT = "product_defect"
    QALI_TEST_DEFECT = "qali_test_defect"
    ENVIRONMENT_FAILURE = "environment_failure"
    FLAKY_INCONCLUSIVE = "flaky_inconclusive"
    EXPECTED_BEHAVIOR = "expected_behavior"


class ClassificationConfidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class FailureGateStatus(StrEnum):
    APPROVED = "approved"
    INCONCLUSIVE = "inconclusive"
    ESCALATED = "escalated"


class FailureEvidenceBundle(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    trace_ref: str = Field(min_length=1, max_length=500)
    accessibility_snapshot_ref: str = Field(min_length=1, max_length=500)
    console_ref: str = Field(min_length=1, max_length=500)
    network_ref: str = Field(min_length=1, max_length=500)
    screenshot_ref: str = Field(min_length=1, max_length=500)

    def references(self) -> tuple[str, ...]:
        return (
            self.trace_ref,
            self.accessibility_snapshot_ref,
            self.console_ref,
            self.network_ref,
            self.screenshot_ref,
        )


class FailureAttempt(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    result: BrowserScenarioResult
    evidence: FailureEvidenceBundle | None = None

    @model_validator(mode="after")
    def require_evidence_for_failure(self) -> FailureAttempt:
        if not self.result.evaluation.passed and self.evidence is None:
            raise ValueError("failed browser attempt requires complete evidence")
        return self


class FailureInvestigationTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    feature_slug: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    execution_task: BrowserExecutionTask
    initial_attempt: FailureAttempt

    @model_validator(mode="after")
    def require_matching_initial_failure(self) -> FailureInvestigationTask:
        if (
            self.project_id != self.execution_task.project_id
            or self.initial_attempt.result.scenario_id
            != self.execution_task.scenario.scenario_id
            or self.initial_attempt.result.evaluation.passed
        ):
            raise ValueError("investigation requires a matching initial failure")
        return self


class FailureAnalysisTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    feature_slug: str
    scenario_id: str
    scenario_title: str
    trace_refs: tuple[str, ...]
    initial_attempt: FailureAttempt
    reproduction_attempt: FailureAttempt
    initial_fingerprint: str = Field(min_length=16, max_length=16)
    reproduction_fingerprint: str = Field(min_length=16, max_length=16)


class FailureAnalysis(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    classification: FailureClassification
    confidence: ClassificationConfidence
    summary: str = Field(min_length=1, max_length=160)
    rationale: str = Field(min_length=1, max_length=2_000)
    failed_oracle_ids: tuple[str, ...] = Field(min_length=1, max_length=40)

    @field_validator("summary")
    @classmethod
    def require_one_line_summary(cls, value: str) -> str:
        if value != value.strip() or "\n" in value or "\r" in value:
            raise ValueError("failure summary must be one trimmed line")
        return value

    @field_validator("failed_oracle_ids")
    @classmethod
    def require_distinct_oracle_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(value) != len(set(value)):
            raise ValueError("failed oracle IDs must be distinct")
        return value


class FailureReview(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    approved: bool
    feedback: tuple[str, ...] = Field(max_length=10)

    @model_validator(mode="after")
    def require_consistent_verdict(self) -> FailureReview:
        if self.approved == bool(self.feedback):
            raise ValueError("failure review verdict and feedback are inconsistent")
        if any(not item.strip() or len(item) > 1_000 for item in self.feedback):
            raise ValueError("failure review feedback is invalid")
        return self


class FailureReviewTask(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    analysis_task: FailureAnalysisTask
    analysis: FailureAnalysis


class FailureFinding(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    finding_id: str = Field(pattern=r"^finding-[0-9a-f]{16}$")
    fingerprint: str = Field(min_length=16, max_length=16)
    project_id: str
    feature_slug: str
    scenario_id: str
    classification: FailureClassification
    summary: str
    trace_refs: tuple[str, ...]
    failed_checks: tuple[OracleCheck, ...] = Field(min_length=1)
    evidence_refs: tuple[str, ...] = Field(min_length=1)
    reproduction_count: int = Field(ge=1, le=1)


class FailureInvestigationResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    status: FailureGateStatus
    analysis: FailureAnalysis
    review: FailureReview | None
    finding: FailureFinding | None
    reproduction_attempt: FailureAttempt
    revision_count: int = Field(ge=0, le=1)


class FailureReproducer(Protocol):
    async def reproduce(self, task: BrowserExecutionTask) -> FailureAttempt: ...


class FailureInvestigator(Protocol):
    async def classify(self, task: FailureAnalysisTask) -> FailureAnalysis: ...

    async def revise(
        self,
        task: FailureAnalysisTask,
        prior: FailureAnalysis,
        feedback: tuple[str, ...],
    ) -> FailureAnalysis: ...


class FailureReviewer(Protocol):
    async def review(self, task: FailureReviewTask) -> FailureReview: ...


class FailureInvestigationError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"failure investigation is invalid: {reason}")


class FailureInvestigationWorkflow:
    def __init__(
        self,
        *,
        reproducer: FailureReproducer,
        investigator: FailureInvestigator,
        reviewer: FailureReviewer,
    ) -> None:
        self._reproducer = reproducer
        self._investigator = investigator
        self._reviewer = reviewer

    async def run(self, task: FailureInvestigationTask) -> FailureInvestigationResult:
        reproduction = await self._reproducer.reproduce(task.execution_task)
        if reproduction.result.scenario_id != task.execution_task.scenario.scenario_id:
            raise FailureInvestigationError("reproduction scenario does not match")

        analysis_task = build_failure_analysis_task(task, reproduction)
        if reproduction.result.evaluation.passed:
            return FailureInvestigationResult(
                status=FailureGateStatus.INCONCLUSIVE,
                analysis=FailureAnalysis(
                    classification=FailureClassification.FLAKY_INCONCLUSIVE,
                    confidence=ClassificationConfidence.HIGH,
                    summary="Failure did not reproduce in a fresh isolated context.",
                    rationale=(
                        "The deterministic rerun passed, so the initial failure cannot "
                        "be presented as a confirmed product defect."
                    ),
                    failed_oracle_ids=tuple(
                        check.oracle_id
                        for check in _failed_checks(task.initial_attempt.result)
                    ),
                ),
                review=None,
                finding=None,
                reproduction_attempt=reproduction,
                revision_count=0,
            )

        analysis = validate_failure_analysis(
            analysis_task,
            await self._investigator.classify(analysis_task),
        )
        review = await self._reviewer.review(
            FailureReviewTask(analysis_task=analysis_task, analysis=analysis)
        )
        revision_count = 0
        if not review.approved:
            analysis = validate_failure_analysis(
                analysis_task,
                await self._investigator.revise(
                    analysis_task,
                    analysis,
                    review.feedback,
                ),
            )
            revision_count = 1
            review = await self._reviewer.review(
                FailureReviewTask(analysis_task=analysis_task, analysis=analysis)
            )

        if not review.approved:
            return FailureInvestigationResult(
                status=FailureGateStatus.ESCALATED,
                analysis=analysis,
                review=review,
                finding=None,
                reproduction_attempt=reproduction,
                revision_count=revision_count,
            )

        return FailureInvestigationResult(
            status=FailureGateStatus.APPROVED,
            analysis=analysis,
            review=review,
            finding=_finding(analysis_task, analysis),
            reproduction_attempt=reproduction,
            revision_count=revision_count,
        )


def normalize_failure_value(value: str | int | bool | None) -> object:
    if not isinstance(value, str):
        return value
    normalized = _ANSI.sub("", value)
    normalized = _TIMESTAMP.sub("<TIMESTAMP>", normalized)
    normalized = _UUID.sub("<UUID>", normalized)
    normalized = _PROCESS_ID.sub("pid=<PID>", normalized)
    normalized = _PORT.sub(":<PORT>", normalized)
    normalized = _TEMP_PATH.sub("<TMPPATH>", normalized)
    normalized = _MEMORY_ADDRESS.sub("<ADDR>", normalized)
    normalized = _REQUEST_ID.sub("<REQ_ID>", normalized)
    normalized = _SOURCE_LINE.sub(r"\g<file>:<LINE>", normalized)
    return _WHITESPACE.sub(" ", normalized).strip()


def failure_fingerprint(value: FailureFingerprintInput) -> str:
    canonical = {
        "project_id": value.project_id,
        "feature_slug": value.feature_slug,
        "scenario_id": value.scenario_id,
        "failed_checks": [
            {
                "oracle_id": check.oracle_id,
                "expected": normalize_failure_value(check.expected),
                "actual": normalize_failure_value(check.actual),
            }
            for check in sorted(value.failed_checks, key=lambda check: check.oracle_id)
        ],
    }
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def validate_failure_analysis(
    task: FailureAnalysisTask,
    analysis: FailureAnalysis,
) -> FailureAnalysis:
    failed_ids = {
        check.oracle_id for check in _failed_checks(task.reproduction_attempt.result)
    }
    if set(analysis.failed_oracle_ids) != failed_ids:
        raise FailureInvestigationError("analysis does not match failed oracles")
    if (
        analysis.classification is FailureClassification.PRODUCT_DEFECT
        and task.initial_fingerprint != task.reproduction_fingerprint
    ):
        raise FailureInvestigationError(
            "product defect classification lacks a matching reproduction"
        )
    return analysis


def _failed_checks(result: BrowserScenarioResult) -> tuple[OracleCheck, ...]:
    return tuple(
        check
        for check in result.evaluation.checks
        if check.status is OracleCheckStatus.FAILED
    )


def _attempt_fingerprint(
    task: FailureInvestigationTask,
    attempt: FailureAttempt,
) -> str:
    return failure_fingerprint(
        FailureFingerprintInput(
            project_id=task.project_id,
            feature_slug=task.feature_slug,
            scenario_id=task.execution_task.scenario.scenario_id,
            failed_checks=_failed_checks(attempt.result),
        )
    )


def build_failure_analysis_task(
    task: FailureInvestigationTask,
    reproduction: FailureAttempt,
) -> FailureAnalysisTask:
    scenario = task.execution_task.scenario
    if reproduction.result.evaluation.passed:
        reproduction_fingerprint = "0" * 16
    else:
        reproduction_fingerprint = _attempt_fingerprint(task, reproduction)
    return FailureAnalysisTask(
        project_id=task.project_id,
        feature_slug=task.feature_slug,
        scenario_id=scenario.scenario_id,
        scenario_title=scenario.title,
        trace_refs=scenario.trace_refs,
        initial_attempt=task.initial_attempt,
        reproduction_attempt=reproduction,
        initial_fingerprint=_attempt_fingerprint(task, task.initial_attempt),
        reproduction_fingerprint=reproduction_fingerprint,
    )


def _finding(
    task: FailureAnalysisTask,
    analysis: FailureAnalysis,
) -> FailureFinding:
    failed_checks = _failed_checks(task.reproduction_attempt.result)
    evidence_refs: list[str] = []
    for attempt in (task.initial_attempt, task.reproduction_attempt):
        if attempt.evidence is not None:
            evidence_refs.extend(attempt.evidence.references())
    evidence_refs.extend(
        check.evidence_ref
        for check in (*_failed_checks(task.initial_attempt.result), *failed_checks)
        if check.evidence_ref is not None
    )
    distinct_evidence_refs = tuple(dict.fromkeys(evidence_refs))
    return FailureFinding(
        finding_id=f"finding-{task.reproduction_fingerprint}",
        fingerprint=task.reproduction_fingerprint,
        project_id=task.project_id,
        feature_slug=task.feature_slug,
        scenario_id=task.scenario_id,
        classification=analysis.classification,
        summary=analysis.summary,
        trace_refs=task.trace_refs,
        failed_checks=failed_checks,
        evidence_refs=distinct_evidence_refs,
        reproduction_count=1,
    )


__all__ = [
    "ClassificationConfidence",
    "FailureAnalysis",
    "FailureAnalysisTask",
    "FailureAttempt",
    "FailureClassification",
    "FailureEvidenceBundle",
    "FailureFinding",
    "FailureFingerprintInput",
    "FailureGateStatus",
    "FailureInvestigationError",
    "FailureInvestigationResult",
    "FailureInvestigationTask",
    "FailureInvestigationWorkflow",
    "FailureReview",
    "FailureReviewTask",
    "build_failure_analysis_task",
    "failure_fingerprint",
    "normalize_failure_value",
    "validate_failure_analysis",
]
