from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import PurePosixPath

from google.adk.models.base_llm import BaseLlm
from pydantic import BaseModel, ConfigDict, Field

from app.browser_attempt_runner import BrowserAttemptRunner
from app.browser_context_factory import RestrictedBrowserContextFactory
from app.browser_evidence_export import ImmutableBrowserEvidenceExporter
from app.browser_executor_agent import AdkBrowserExecutor
from app.playwright_mcp_backend import PlaywrightMcpBackendFactory
from app.playwright_mcp_process import PlaywrightMcpSettings
from app.run_artifact_repository import (
    GcsRunArtifactSettings,
    create_gcs_run_artifact_repository,
)
from app.secret_manager_credentials import (
    SecretManagerCredentialSettings,
    create_secret_manager_credential_resolver,
)


class BrowserRuntimeSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    output_root: PurePosixPath
    gcp_project_id: str = Field(
        min_length=6,
        max_length=63,
        pattern=r"^[a-z][a-z0-9-]*[a-z0-9]$",
    )
    artifact_bucket_name: str = Field(min_length=1, max_length=222)
    artifact_timeout_seconds: int = Field(default=60, ge=1, le=300)
    credential_timeout_seconds: float = Field(default=30, gt=0, le=60)


def create_production_browser_attempt_runner(
    settings: BrowserRuntimeSettings,
    *,
    browser_model: BaseLlm | str | None = None,
) -> BrowserAttemptRunner:
    backends = PlaywrightMcpBackendFactory(
        settings=PlaywrightMcpSettings(output_root=settings.output_root)
    )
    credentials = create_secret_manager_credential_resolver(
        SecretManagerCredentialSettings(
            project_id=settings.gcp_project_id,
            timeout_seconds=settings.credential_timeout_seconds,
        )
    )
    artifacts = create_gcs_run_artifact_repository(
        GcsRunArtifactSettings(
            bucket_name=settings.artifact_bucket_name,
            timeout_seconds=settings.artifact_timeout_seconds,
        )
    )
    return BrowserAttemptRunner(
        contexts=RestrictedBrowserContextFactory(
            backends=backends,
            credentials=credentials,
        ),
        executor=AdkBrowserExecutor(model=browser_model),
        evidence=ImmutableBrowserEvidenceExporter(
            captures=backends,
            artifacts=artifacts,
        ),
    )


def create_production_browser_attempt_runner_from_env(
    environ: Mapping[str, str] | None = None,
) -> BrowserAttemptRunner:
    values = os.environ if environ is None else environ
    if values.get("QALI_MODE") != "live":
        raise RuntimeError("QALI_MODE must be 'live' for the browser runtime")
    if values.get("GOOGLE_GENAI_USE_VERTEXAI", "").casefold() != "false":
        raise RuntimeError(
            "GOOGLE_GENAI_USE_VERTEXAI must be 'false' for free-tier model use"
        )
    _required(values, "GEMINI_API_KEY")
    settings = BrowserRuntimeSettings(
        output_root=_required(values, "PLAYWRIGHT_MCP_OUTPUT_ROOT"),
        gcp_project_id=_required(values, "GOOGLE_CLOUD_PROJECT"),
        artifact_bucket_name=_required(values, "GCS_ARTIFACTS_BUCKET"),
        artifact_timeout_seconds=_required_int(values, "GCS_TIMEOUT_SECONDS"),
        credential_timeout_seconds=_required_float(
            values,
            "SECRET_MANAGER_TIMEOUT_SECONDS",
        ),
    )
    return create_production_browser_attempt_runner(settings)


def _required(values: Mapping[str, str], name: str) -> str:
    value = values.get(name)
    if value is None or not value.strip():
        raise RuntimeError(f"{name} must be set in live mode")
    return value


def _required_int(values: Mapping[str, str], name: str) -> int:
    value = _required(values, name)
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def _required_float(values: Mapping[str, str], name: str) -> float:
    value = _required(values, name)
    try:
        return float(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc


__all__ = [
    "BrowserRuntimeSettings",
    "create_production_browser_attempt_runner",
    "create_production_browser_attempt_runner_from_env",
]
