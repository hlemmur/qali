from __future__ import annotations

from pathlib import PurePosixPath

from app.browser_runtime import BrowserRuntimeSettings
from app.feature_request_workflow import FeatureRequestWorkflow
from app.feature_worker_runtime import create_production_feature_request_workflow
from app.slack_feature_results import SlackFeatureResultPublisher


class _SlackClient:
    async def chat_update(self, *, channel: str, ts: str, text: str) -> None:
        del channel, ts, text


def test_production_feature_workflow_installs_one_browser_runner_for_attempts_and_reproductions(
    monkeypatch,
) -> None:
    browser_runner = object()
    run_artifacts = object()
    monkeypatch.setattr(
        "app.feature_worker_runtime.create_production_browser_attempt_runner",
        lambda settings, *, browser_model=None: browser_runner,
    )
    monkeypatch.setattr(
        "app.feature_worker_runtime.create_gcs_run_artifact_repository",
        lambda settings: run_artifacts,
    )

    workflow = create_production_feature_request_workflow(
        browser_settings=BrowserRuntimeSettings(
            output_root=PurePosixPath("/tmp/qali-mcp"),
            gcp_project_id="qali-test-project",
            artifact_bucket_name="qali-artifacts",
        ),
        slack_client=_SlackClient(),
        specialist_model="gemini-3.7-flash",
        reviewer_model="gemini-3.7-flash",
    )

    assert isinstance(workflow, FeatureRequestWorkflow)
    execution = workflow._execution
    assert execution._scenario_runner is browser_runner
    assert execution._failure_workflow._reproducer is browser_runner
    assert execution._artifacts is run_artifacts
    assert isinstance(execution._slack_results, SlackFeatureResultPublisher)
