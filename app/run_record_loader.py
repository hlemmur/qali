from __future__ import annotations

import asyncio
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.browser_executor_agent import BrowserScenarioResult
from app.failure_investigation import FailureInvestigationResult
from app.run_artifacts import FeatureRunRecord, RunArtifactDocument
from app.test_design import TestPlan


class RunRecordArtifactReader(Protocol):
    async def read(self, object_name: str) -> RunArtifactDocument: ...


class _PersistedScenario(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    scenario_id: str
    passed: bool
    step_count: int = Field(gt=0)
    evaluation: dict[str, Any]
    investigation: FailureInvestigationResult | None

    @model_validator(mode="after")
    def require_matching_evaluation(self) -> _PersistedScenario:
        if self.browser_result().evaluation.passed != self.passed:
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


class FeatureRunRecordLoader:
    def __init__(self, *, artifacts: RunRecordArtifactReader) -> None:
        self._artifacts = artifacts

    async def load(self, project_id: str, run_id: str) -> FeatureRunRecord:
        prefix = f"projects/{project_id}/runs/{run_id}"
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
            raise ValueError("run source artifacts have unexpected content types")
        try:
            plan = TestPlan.model_validate_json(plan_document.content)
            persisted = _PersistedRunResult.model_validate_json(result_document.content)
            request_markdown = request_document.content.decode("utf-8").strip()
        except (UnicodeDecodeError, ValueError):
            raise ValueError("run source artifacts are invalid") from None
        if (
            persisted.project_id != project_id
            or persisted.run_id != run_id
            or plan.project_id != project_id
            or persisted.feature_name != plan.feature_name
        ):
            raise ValueError("run source artifacts do not match the requested run")
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
            raise ValueError("run source artifact summary is inconsistent")
        return record


__all__ = ["FeatureRunRecordLoader", "RunRecordArtifactReader"]
