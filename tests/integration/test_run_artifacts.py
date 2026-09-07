from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.failure_investigation import (
    FailureInvestigationTask,
    FailureInvestigationWorkflow,
    FailureReview,
)
from app.run_artifacts import (
    FeatureRunArtifactBundle,
    FeatureRunRecord,
    compile_feature_run_artifacts,
)
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_failure_investigation_workflow import (
    _analysis,
    _attempt,
    _InvestigatorDouble,
    _ReproducerDouble,
    _result,
    _ReviewerDouble,
)
from tests.integration.test_plan_reviewer_agent import _review_task


async def _failed_run() -> FeatureRunRecord:
    execution_task = _execution_task()
    investigation = await FailureInvestigationWorkflow(
        reproducer=_ReproducerDouble(_attempt(passed=False, run="reproduction")),
        investigator=_InvestigatorDouble([_analysis()]),
        reviewer=_ReviewerDouble([FailureReview(approved=True, feedback=())]),
    ).run(
        FailureInvestigationTask(
            project_id=execution_task.project_id,
            feature_slug="profile-editing",
            execution_task=execution_task,
            initial_attempt=_attempt(passed=False, run="initial"),
        )
    )
    return FeatureRunRecord(
        project_id="project-alpha",
        run_id="run-profile-001",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        plan=_review_task().plan,
        scenario_results=(_result(passed=False),),
        investigations=(investigation,),
    )


@pytest.mark.asyncio
async def test_failed_run_compiles_operational_and_human_artifacts() -> None:
    record = await _failed_run()

    bundle = compile_feature_run_artifacts(record)

    paths = {document.object_name for document in bundle.documents}
    prefix = "projects/project-alpha/runs/run-profile-001"
    assert paths == {
        f"{prefix}/request.md",
        f"{prefix}/plan.json",
        f"{prefix}/result.json",
        f"{prefix}/report.md",
        f"projects/project-alpha/issues/{record.investigations[0].finding.finding_id}.md",
    }
    result = json.loads(bundle.document(f"{prefix}/result.json").content)
    assert result["scenario_count"] == 1
    assert result["check_count"] == 2
    assert result["passed_scenario_count"] == 0
    assert result["finding_ids"] == [record.investigations[0].finding.finding_id]

    report = bundle.document(f"{prefix}/report.md").content.decode()
    assert "1 scenario" in report
    assert "2 checks" in report
    assert record.investigations[0].finding.finding_id in report
    assert "Saved profile name remains unchanged." in report

    issue_path = (
        "projects/project-alpha/issues/"
        f"{record.investigations[0].finding.finding_id}.md"
    )
    issue = bundle.document(issue_path).content.decode()
    assert "Change and save the display name." in issue
    assert "Expected: `Updated Name`" in issue
    assert "Actual: `Original Name`" in issue
    assert "evidence://initial/trace" in issue
    assert bundle == compile_feature_run_artifacts(record)


def test_successful_run_stays_minimal_and_creates_no_issue_artifact() -> None:
    plan = _review_task().plan
    record = FeatureRunRecord(
        project_id="project-alpha",
        run_id="run-profile-002",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        plan=plan,
        scenario_results=(_result(passed=True),),
        investigations=(),
    )

    bundle = compile_feature_run_artifacts(record)

    assert len(bundle.documents) == 4
    report = bundle.document(
        "projects/project-alpha/runs/run-profile-002/report.md"
    ).content.decode()
    assert report == (
        "# Qali feature test result\n\n"
        "Profile display-name editing: 1 scenario passed (2 checks).\n"
    )


@pytest.mark.asyncio
async def test_artifact_bundle_rejects_paths_outside_the_project_layout() -> None:
    bundle = compile_feature_run_artifacts(await _failed_run())
    payload = bundle.model_dump(mode="python")
    payload["documents"][0]["object_name"] = "../../outside/request.md"

    with pytest.raises(ValidationError, match="planned storage layout"):
        FeatureRunArtifactBundle.model_validate(payload)
