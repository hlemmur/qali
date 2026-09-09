from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI

from app.feature_worker_job import FeatureTestJob
from app.feature_worker_runtime import (
    SlackFeatureProgressReporter,
    create_feature_worker_runtime_from_env,
)


def _live_environment() -> dict[str, str]:
    return {
        "QALI_MODE": "live",
        "GOOGLE_GENAI_USE_VERTEXAI": "false",
        "GEMINI_API_KEY": "synthetic-free-tier-key",
        "GOOGLE_CLOUD_PROJECT": "qali-507317",
        "FIRESTORE_DATABASE_ID": "(default)",
        "FIRESTORE_JOBS_COLLECTION": "jobs",
        "FIRESTORE_JOB_LOCKS_COLLECTION": "job-locks",
        "FIRESTORE_JOB_LEASE_SECONDS": "960",
        "GCS_ARTIFACTS_BUCKET": "qali-private-artifacts",
        "GCS_TIMEOUT_SECONDS": "60",
        "CLOUD_TASKS_QUEUE_ID": "qali-jobs",
        "SLACK_BOT_TOKEN": "xoxb-synthetic-token",
        "PLAYWRIGHT_MCP_OUTPUT_ROOT": "/tmp/qali-mcp",
        "SECRET_MANAGER_TIMEOUT_SECONDS": "30",
        "QALI_JOB_TIMEOUT_SECONDS": "900",
        "QALI_JOB_MAX_DELIVERY_ATTEMPTS": "3",
    }


@pytest.mark.asyncio
async def test_feature_progress_starts_in_the_claimed_slack_thread() -> None:
    class SlackClient:
        def __init__(self) -> None:
            self.messages: list[dict[str, object]] = []

        async def chat_postMessage(self, **message):
            self.messages.append(message)
            return {"ts": "1788220800.222000"}

    client = SlackClient()
    job = FeatureTestJob(
        job_id="slack:Ev-feature-progress",
        source_event_id="Ev-feature-progress",
        project_id="project-alpha",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.221000",
        run_id="run-feature-progress",
        feature_slug="catalog-filtering",
        request_text="Test catalog filtering",
    )

    message = await SlackFeatureProgressReporter(client=client).start(job)

    assert message.model_dump() == {
        "channel_id": "C-QALI",
        "thread_ts": "1788220800.221000",
        "message_ts": "1788220800.222000",
    }
    assert client.messages == [
        {
            "channel": "C-QALI",
            "thread_ts": "1788220800.221000",
            "text": "Feature testing: request received.",
            "unfurl_links": False,
            "unfurl_media": False,
        }
    ]


def test_live_feature_worker_composes_durable_runtime_from_explicit_environment(
    monkeypatch,
) -> None:
    captured: dict[str, list[Any]] = {
        "jobs": [],
        "contexts": [],
        "slack": [],
        "workflow": [],
    }
    jobs = object()
    contexts = object()
    slack = object()
    workflow = object()

    def capture(name: str, result: object):
        def factory(settings):
            captured[name].append(settings)
            return result

        return factory

    monkeypatch.setattr(
        "app.feature_worker_runtime.create_firestore_job_repository",
        capture("jobs", jobs),
    )
    monkeypatch.setattr(
        "app.feature_worker_runtime.create_gcs_feature_context_repository",
        capture("contexts", contexts),
    )

    def create_slack(token: str) -> object:
        captured["slack"].append(token)
        return slack

    monkeypatch.setattr(
        "app.feature_worker_runtime.create_slack_web_client",
        create_slack,
    )

    def create_workflow(*, browser_settings, slack_client, **models):
        captured["workflow"].append((browser_settings, slack_client, models))
        return workflow

    monkeypatch.setattr(
        "app.feature_worker_runtime.create_production_feature_request_workflow",
        create_workflow,
    )

    app = create_feature_worker_runtime_from_env(_live_environment())

    assert isinstance(app, FastAPI)
    assert app.state.qali_mode == "live"
    assert captured["slack"] == ["xoxb-synthetic-token"]
    assert captured["jobs"][0].model_dump() == {
        "project_id": "qali-507317",
        "database_id": "(default)",
        "collection": "jobs",
        "lock_collection": "job-locks",
        "lease_seconds": 960,
    }
    assert captured["contexts"][0].model_dump() == {
        "bucket_name": "qali-private-artifacts",
        "timeout_seconds": 60,
    }
    browser_settings, workflow_slack, models = captured["workflow"][0]
    assert workflow_slack is slack
    assert models == {"specialist_model": None, "reviewer_model": None}
    assert browser_settings.model_dump(mode="json") == {
        "output_root": "/tmp/qali-mcp",
        "gcp_project_id": "qali-507317",
        "artifact_bucket_name": "qali-private-artifacts",
        "artifact_timeout_seconds": 60,
        "credential_timeout_seconds": 30.0,
    }
    assert app.state.feature_runtime_settings.model_dump(mode="json") == {
        "queue_name": "qali-jobs",
        "browser": browser_settings.model_dump(mode="json"),
        "context_bucket_name": "qali-private-artifacts",
        "context_timeout_seconds": 60,
        "execution": {
            "timeout_seconds": 900.0,
            "max_delivery_attempts": 3,
        },
    }


@pytest.mark.parametrize("missing_variable", tuple(_live_environment()))
def test_live_feature_worker_fails_closed_when_configuration_is_missing(
    missing_variable: str,
) -> None:
    environment = _live_environment()
    del environment[missing_variable]

    with pytest.raises(RuntimeError, match=missing_variable):
        create_feature_worker_runtime_from_env(environment)


def test_live_feature_worker_validates_configuration_before_creating_adapters(
    monkeypatch,
) -> None:
    environment = _live_environment()
    del environment["SECRET_MANAGER_TIMEOUT_SECONDS"]

    def unexpected_adapter(settings) -> object:
        del settings
        raise AssertionError("adapter created before configuration was validated")

    monkeypatch.setattr(
        "app.feature_worker_runtime.create_firestore_job_repository",
        unexpected_adapter,
    )

    with pytest.raises(RuntimeError, match="SECRET_MANAGER_TIMEOUT_SECONDS"):
        create_feature_worker_runtime_from_env(environment)
