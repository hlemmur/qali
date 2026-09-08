from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.project_projections import (
    FindingProjectionState,
    FindingStatus,
    ProjectRunAuditEvent,
    compile_project_projections,
)
from tests.integration.test_run_artifacts import _failed_run
from tests.integration.test_slack_feature_results import _successful_run


@pytest.mark.asyncio
async def test_project_projections_are_chronological_and_include_honest_counts() -> (
    None
):
    failed = await _failed_run()
    successful = _successful_run().model_copy(update={"run_id": "run-profile-002"})
    events = (
        ProjectRunAuditEvent(
            record=successful,
            completed_at=datetime(2026, 9, 8, 10, 5, tzinfo=UTC),
        ),
        ProjectRunAuditEvent(
            record=failed,
            completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
        ),
    )

    bundle = compile_project_projections(events)

    assert bundle.project_id == "project-alpha"
    assert tuple(document.object_name for document in bundle.documents) == (
        "projects/project-alpha/logs/testing-log.md",
        "projects/project-alpha/issues/index.md",
    )
    testing_log = bundle.document(
        "projects/project-alpha/logs/testing-log.md"
    ).content.decode()
    assert testing_log.index("run-profile-001") < testing_log.index("run-profile-002")
    assert "0/1 scenarios passed (2 checks)" in testing_log
    assert "1/1 scenarios passed (2 checks)" in testing_log
    finding = failed.investigations[0].finding
    assert finding is not None
    assert finding.finding_id in testing_log


@pytest.mark.asyncio
async def test_issue_index_defaults_findings_open_and_applies_persisted_status() -> (
    None
):
    failed = await _failed_run()
    finding = failed.investigations[0].finding
    assert finding is not None
    event = ProjectRunAuditEvent(
        record=failed,
        completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
    )

    open_bundle = compile_project_projections((event,))
    resolved_bundle = compile_project_projections(
        (event,),
        finding_states=(
            FindingProjectionState(
                finding_id=finding.finding_id,
                status=FindingStatus.RESOLVED,
            ),
        ),
    )

    open_index = open_bundle.document(
        "projects/project-alpha/issues/index.md"
    ).content.decode()
    resolved_index = resolved_bundle.document(
        "projects/project-alpha/issues/index.md"
    ).content.decode()
    assert f"- [OPEN] `{finding.finding_id}`" in open_index
    assert f"- [RESOLVED] `{finding.finding_id}`" in resolved_index
    assert finding.summary in resolved_index
    assert "run-profile-001" in resolved_index


@pytest.mark.asyncio
async def test_projection_output_is_stable_for_event_input_order() -> None:
    failed = await _failed_run()
    successful = _successful_run().model_copy(update={"run_id": "run-profile-002"})
    first = ProjectRunAuditEvent(
        record=failed,
        completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
    )
    second = ProjectRunAuditEvent(
        record=successful,
        completed_at=datetime(2026, 9, 8, 10, 5, tzinfo=UTC),
    )

    assert compile_project_projections((first, second)) == compile_project_projections(
        (second, first)
    )


@pytest.mark.asyncio
async def test_projection_rejects_unknown_status_and_cross_project_events() -> None:
    failed = await _failed_run()
    finding = failed.investigations[0].finding
    assert finding is not None
    event = ProjectRunAuditEvent(
        record=failed,
        completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
    )

    with pytest.raises(ValueError, match="unknown finding"):
        compile_project_projections(
            (event,),
            finding_states=(
                FindingProjectionState(
                    finding_id="finding-0000000000000000",
                    status=FindingStatus.RESOLVED,
                ),
            ),
        )

    other_project = event.model_copy(
        update={
            "record": failed.model_copy(
                update={
                    "project_id": "project-beta",
                    "plan": failed.plan.model_copy(
                        update={"project_id": "project-beta"}
                    ),
                }
            )
        }
    )
    with pytest.raises(ValueError, match="one project"):
        compile_project_projections((event, other_project))
