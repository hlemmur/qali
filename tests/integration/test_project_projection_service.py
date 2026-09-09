from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.project_projection_repository import InMemoryProjectProjectionRepository
from app.project_projection_service import ProjectProjectionUpdater
from app.run_artifact_repository import InMemoryRunArtifactRepository
from app.run_artifacts import compile_feature_run_artifacts
from tests.integration.test_run_artifacts import _failed_run
from tests.integration.test_slack_feature_results import _successful_run


@pytest.mark.asyncio
async def test_projection_refresh_rebuilds_complete_history_from_immutable_runs() -> (
    None
):
    timestamps = iter(
        (
            datetime(2026, 9, 9, 14, 45, tzinfo=UTC),
            datetime(2026, 9, 9, 14, 50, tzinfo=UTC),
        )
    )
    history = InMemoryRunArtifactRepository(clock=lambda: next(timestamps))
    projections = InMemoryProjectProjectionRepository()
    updater = ProjectProjectionUpdater(history=history, projections=projections)
    failed = await _failed_run()
    successful = _successful_run().model_copy(update={"run_id": "run-profile-002"})

    await history.publish(compile_feature_run_artifacts(failed))
    first = await updater.refresh("project-alpha")
    await history.publish(compile_feature_run_artifacts(successful))
    second = await updater.refresh("project-alpha")

    assert tuple(pointer.generation for pointer in first.projections) == (1, 1)
    assert tuple(pointer.generation for pointer in second.projections) == (2, 2)
    testing_log = await projections.read("projects/project-alpha/logs/testing-log.md")
    rendered = testing_log.content.decode()
    assert rendered.index(failed.run_id) < rendered.index(successful.run_id)
    assert "0/1 scenarios passed" in rendered
    assert "1/1 scenarios passed" in rendered
