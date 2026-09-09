from __future__ import annotations

import pytest

from app.browser_attempt_runner import BrowserAttemptRunner
from app.browser_context_factory import RestrictedBrowserContextFactory
from app.browser_evidence_export import ImmutableBrowserEvidenceExporter
from app.browser_executor_agent import AdkBrowserExecutor
from app.browser_runtime import (
    BrowserRuntimeSettings,
    create_production_browser_attempt_runner,
    create_production_browser_attempt_runner_from_env,
)
from app.playwright_mcp_backend import PlaywrightMcpBackendFactory


def test_production_runtime_composes_only_concrete_browser_integrations(
    monkeypatch,
) -> None:
    credential_resolver = object()
    artifact_repository = object()
    captured = {}

    def create_credentials(settings):
        captured["credential_settings"] = settings
        return credential_resolver

    def create_artifacts(settings):
        captured["artifact_settings"] = settings
        return artifact_repository

    monkeypatch.setattr(
        "app.browser_runtime.create_secret_manager_credential_resolver",
        create_credentials,
    )
    monkeypatch.setattr(
        "app.browser_runtime.create_gcs_run_artifact_repository",
        create_artifacts,
    )

    runner = create_production_browser_attempt_runner(
        BrowserRuntimeSettings(
            output_root="/tmp/qali-browser",
            gcp_project_id="qali-507317",
            artifact_bucket_name="qali-private-artifacts",
        )
    )

    assert isinstance(runner, BrowserAttemptRunner)
    assert isinstance(runner._contexts, RestrictedBrowserContextFactory)
    assert isinstance(runner._executor, AdkBrowserExecutor)
    assert isinstance(runner._evidence, ImmutableBrowserEvidenceExporter)
    assert isinstance(runner._contexts._backends, PlaywrightMcpBackendFactory)
    assert runner._contexts._backends is runner._evidence._captures
    assert runner._contexts._credentials is credential_resolver
    assert runner._evidence._artifacts is artifact_repository
    assert captured["credential_settings"].project_id == "qali-507317"
    assert captured["artifact_settings"].bucket_name == "qali-private-artifacts"


def test_live_browser_runtime_requires_explicit_environment_before_composition(
    monkeypatch,
) -> None:
    expected_runner = object()
    captured = []

    def create_runner(settings):
        captured.append(settings)
        return expected_runner

    monkeypatch.setattr(
        "app.browser_runtime.create_production_browser_attempt_runner",
        create_runner,
    )

    runner = create_production_browser_attempt_runner_from_env(
        {
            "QALI_MODE": "live",
            "GOOGLE_GENAI_USE_VERTEXAI": "false",
            "GEMINI_API_KEY": "synthetic-free-tier-key",
            "GOOGLE_CLOUD_PROJECT": "qali-507317",
            "GCS_ARTIFACTS_BUCKET": "qali-private-artifacts",
            "GCS_TIMEOUT_SECONDS": "45",
            "PLAYWRIGHT_MCP_OUTPUT_ROOT": "/tmp/qali-browser",
            "SECRET_MANAGER_TIMEOUT_SECONDS": "20",
        }
    )

    assert runner is expected_runner
    assert captured == [
        BrowserRuntimeSettings(
            output_root="/tmp/qali-browser",
            gcp_project_id="qali-507317",
            artifact_bucket_name="qali-private-artifacts",
            artifact_timeout_seconds=45,
            credential_timeout_seconds=20,
        )
    ]


def test_live_browser_runtime_fails_closed_without_free_tier_model_key(
    monkeypatch,
) -> None:
    def unexpected_composition(settings):
        del settings
        raise AssertionError("runtime composed before model config was validated")

    monkeypatch.setattr(
        "app.browser_runtime.create_production_browser_attempt_runner",
        unexpected_composition,
    )

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        create_production_browser_attempt_runner_from_env(
            {
                "QALI_MODE": "live",
                "GOOGLE_GENAI_USE_VERTEXAI": "false",
                "GOOGLE_CLOUD_PROJECT": "qali-507317",
                "GCS_ARTIFACTS_BUCKET": "qali-private-artifacts",
                "GCS_TIMEOUT_SECONDS": "45",
                "PLAYWRIGHT_MCP_OUTPUT_ROOT": "/tmp/qali-browser",
                "SECRET_MANAGER_TIMEOUT_SECONDS": "20",
            }
        )


@pytest.mark.parametrize(
    "missing_variable",
    (
        "GOOGLE_CLOUD_PROJECT",
        "GCS_ARTIFACTS_BUCKET",
        "GCS_TIMEOUT_SECONDS",
        "PLAYWRIGHT_MCP_OUTPUT_ROOT",
        "SECRET_MANAGER_TIMEOUT_SECONDS",
    ),
)
def test_live_browser_runtime_fails_closed_when_configuration_is_missing(
    missing_variable: str,
) -> None:
    environment = {
        "QALI_MODE": "live",
        "GOOGLE_GENAI_USE_VERTEXAI": "false",
        "GEMINI_API_KEY": "synthetic-free-tier-key",
        "GOOGLE_CLOUD_PROJECT": "qali-507317",
        "GCS_ARTIFACTS_BUCKET": "qali-private-artifacts",
        "GCS_TIMEOUT_SECONDS": "45",
        "PLAYWRIGHT_MCP_OUTPUT_ROOT": "/tmp/qali-browser",
        "SECRET_MANAGER_TIMEOUT_SECONDS": "20",
    }
    del environment[missing_variable]

    with pytest.raises(RuntimeError, match=missing_variable):
        create_production_browser_attempt_runner_from_env(environment)
