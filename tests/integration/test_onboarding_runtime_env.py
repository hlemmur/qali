from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi import FastAPI

from app.onboarding_runtime import create_onboarding_runtime_from_env
from app.project_identity import project_id_for_channel


def _live_environment() -> dict[str, str]:
    environment = {
        "QALI_MODE": "live",
        "GOOGLE_GENAI_USE_VERTEXAI": "false",
        "GEMINI_API_KEY": "synthetic-free-tier-key",
        "GOOGLE_CLOUD_PROJECT": "qali-507317",
        "FIRESTORE_DATABASE_ID": "(default)",
        "FIRESTORE_JOBS_COLLECTION": "jobs",
        "FIRESTORE_JOB_LOCKS_COLLECTION": "job-locks",
        "FIRESTORE_JOB_LEASE_SECONDS": "960",
        "FIRESTORE_PROJECTS_COLLECTION": "projects",
        "FIRESTORE_SOURCES_COLLECTION": "sources",
        "GCS_ARTIFACTS_BUCKET": "qali-private-artifacts",
        "GCS_TIMEOUT_SECONDS": "60",
        "CLOUD_TASKS_QUEUE_ID": "qali-jobs",
        "SLACK_BOT_TOKEN": "xoxb-synthetic-token",
        "SLACK_API_TIMEOUT_SECONDS": "30",
        "QALI_ALLOWED_ORIGINS": ("https://app.example.test,https://docs.example.test"),
        "QALI_SOURCE_MAX_BYTES": "5000000",
        "QALI_SOURCE_MAX_REDIRECTS": "3",
        "QALI_SOURCE_TIMEOUT_SECONDS": "30",
        "QALI_SOURCE_MAX_SOURCES": "10",
        "CLAMAV_EXECUTABLE": "clamscan",
        "CLAMAV_TIMEOUT_SECONDS": "30",
        "CLAMAV_SCANNER_ID": "clamav-engine-1-signatures-20260905",
        "QALI_JOB_TIMEOUT_SECONDS": "900",
        "QALI_JOB_MAX_DELIVERY_ATTEMPTS": "3",
    }
    environment["QALI_BROWSER_TARGET_POLICY_JSON"] = json.dumps(
        {
            "project_id": project_id_for_channel("T-QALI", "C-QALI"),
            "start_url": "https://app.example.test/profile",
            "allowed_origins": ["https://app.example.test"],
            "allowed_actions": [
                "navigate",
                "snapshot",
                "click_ref",
                "type_text",
                "observe_oracle",
                "capture_evidence",
            ],
            "credential_references": [],
            "safe_consequential_actions": ["save-profile"],
            "max_steps": 20,
            "timeout_seconds": 300,
        }
    )
    return environment


def test_live_worker_composes_durable_adapters_from_explicit_environment(
    monkeypatch,
) -> None:
    captured: dict[str, list[Any]] = {
        "jobs": [],
        "projects": [],
        "sources": [],
        "raw": [],
        "knowledge": [],
        "progress": [],
        "slack_files": [],
        "feature_context": [],
    }
    jobs = object()
    projects = object()
    sources = object()
    raw = object()
    knowledge = object()
    progress = object()
    slack_files = object()
    feature_context = object()

    def capture(name: str, result: object):
        def factory(settings):
            captured[name].append(settings)
            return result

        return factory

    monkeypatch.setattr(
        "app.onboarding_runtime.create_firestore_job_repository",
        capture("jobs", jobs),
    )
    monkeypatch.setattr(
        "app.onboarding_runtime.create_firestore_project_repository",
        capture("projects", projects),
    )
    monkeypatch.setattr(
        "app.onboarding_runtime.create_firestore_source_repository",
        capture("sources", sources),
    )
    monkeypatch.setattr(
        "app.onboarding_runtime.create_gcs_raw_source_repository",
        capture("raw", raw),
    )
    monkeypatch.setattr(
        "app.onboarding_runtime.create_gcs_knowledge_repository",
        capture("knowledge", knowledge),
    )
    monkeypatch.setattr(
        "app.onboarding_runtime.create_gcs_feature_context_repository",
        capture("feature_context", feature_context),
    )

    def create_progress(token: str) -> object:
        captured["progress"].append(token)
        return progress

    monkeypatch.setattr(
        "app.onboarding_runtime.create_slack_progress_reporter",
        create_progress,
    )
    monkeypatch.setattr(
        "app.onboarding_runtime.create_slack_api_file_client",
        capture("slack_files", slack_files),
    )

    app = create_onboarding_runtime_from_env(_live_environment())

    assert isinstance(app, FastAPI)
    assert app.state.qali_mode == "live"
    assert captured["progress"] == ["xoxb-synthetic-token"]
    assert captured["jobs"][0].model_dump() == {
        "project_id": "qali-507317",
        "database_id": "(default)",
        "collection": "jobs",
        "lock_collection": "job-locks",
        "lease_seconds": 960,
    }
    assert captured["projects"][0].model_dump() == {
        "gcp_project_id": "qali-507317",
        "database_id": "(default)",
        "collection": "projects",
    }
    assert captured["sources"][0].model_dump() == {
        "project_id": "qali-507317",
        "database_id": "(default)",
        "collection": "sources",
    }
    assert captured["raw"][0].model_dump() == {
        "bucket_name": "qali-private-artifacts",
        "upload_timeout_seconds": 60,
    }
    assert captured["knowledge"][0].model_dump() == {
        "bucket_name": "qali-private-artifacts",
        "timeout_seconds": 60,
    }
    assert captured["feature_context"][0].model_dump() == {
        "bucket_name": "qali-private-artifacts",
        "timeout_seconds": 60,
    }
    assert app.state.feature_target_policy.model_dump(mode="json") == {
        "project_id": project_id_for_channel("T-QALI", "C-QALI"),
        "start_url": "https://app.example.test/profile",
        "allowed_origins": ["https://app.example.test"],
        "allowed_actions": [
            "navigate",
            "snapshot",
            "click_ref",
            "type_text",
            "observe_oracle",
            "capture_evidence",
        ],
        "credential_references": [],
        "safe_consequential_actions": ["save-profile"],
        "max_steps": 20,
        "timeout_seconds": 300,
    }
    slack_file_settings = captured["slack_files"][0]
    assert slack_file_settings.token.get_secret_value() == "xoxb-synthetic-token"
    assert slack_file_settings.timeout_seconds == 30
    assert app.state.onboarding_runtime_settings.model_dump(mode="json") == {
        "worker": {"queue_name": "qali-jobs"},
        "source": {
            "allowed_origins": [
                "https://app.example.test",
                "https://docs.example.test",
            ],
            "max_bytes": 5_000_000,
            "max_redirects": 3,
            "timeout_seconds": 30.0,
            "max_sources": 10,
        },
        "clamav": {
            "executable": "clamscan",
            "timeout_seconds": 30.0,
            "scanner_id": "clamav-engine-1-signatures-20260905",
        },
        "slack_files": {
            "token": "**********",
            "timeout_seconds": 30.0,
        },
        "execution": {
            "timeout_seconds": 900.0,
            "max_delivery_attempts": 3,
        },
    }


@pytest.mark.parametrize("missing_variable", tuple(_live_environment()))
def test_live_worker_fails_closed_when_configuration_is_missing(
    missing_variable: str,
) -> None:
    environment = _live_environment()
    del environment[missing_variable]

    with pytest.raises(RuntimeError, match=missing_variable):
        create_onboarding_runtime_from_env(environment)


def test_live_worker_validates_all_configuration_before_creating_adapters(
    monkeypatch,
) -> None:
    environment = _live_environment()
    del environment["FIRESTORE_SOURCES_COLLECTION"]

    def unexpected_adapter(settings) -> object:
        del settings
        raise AssertionError("adapter created before configuration was validated")

    monkeypatch.setattr(
        "app.onboarding_runtime.create_firestore_job_repository",
        unexpected_adapter,
    )

    with pytest.raises(RuntimeError, match="FIRESTORE_SOURCES_COLLECTION"):
        create_onboarding_runtime_from_env(environment)


def test_live_worker_validates_allowed_origins_before_creating_adapters(
    monkeypatch,
) -> None:
    environment = _live_environment()
    environment["QALI_ALLOWED_ORIGINS"] = "http://127.0.0.1"

    def unexpected_adapter(settings) -> object:
        del settings
        raise AssertionError("adapter created before origin policy was validated")

    monkeypatch.setattr(
        "app.onboarding_runtime.create_firestore_job_repository",
        unexpected_adapter,
    )

    with pytest.raises(ValueError, match="HTTPS"):
        create_onboarding_runtime_from_env(environment)
