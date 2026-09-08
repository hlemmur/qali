from __future__ import annotations

import hashlib
import json
import re
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from app.browser_executor_agent import BrowserExecutionTask, BrowserScenarioResult
from app.failure_investigation import FailureEvidenceBundle
from app.run_artifact_repository import ArtifactBundle, PublishedRunArtifacts
from app.run_artifacts import BrowserEvidenceArtifactBundle, RunArtifactDocument

_RESOURCE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")


class BrowserFailureEvidenceCapture(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    trace: bytes = Field(min_length=1, max_length=50_000_000)
    accessibility_snapshot: str = Field(min_length=1, max_length=200_000)
    console_events: tuple[dict[str, JsonValue], ...] = Field(max_length=10_000)
    network_events: tuple[dict[str, JsonValue], ...] = Field(max_length=10_000)
    screenshot: bytes = Field(min_length=1, max_length=10_000_000)


class BrowserEvidenceCaptureSource(Protocol):
    async def capture_failure(
        self,
        *,
        context_id: str,
        task: BrowserExecutionTask,
        result: BrowserScenarioResult,
    ) -> BrowserFailureEvidenceCapture: ...


class BrowserEvidenceArtifactRepository(Protocol):
    async def publish(
        self,
        bundle: ArtifactBundle,
    ) -> PublishedRunArtifacts: ...


class BrowserEvidenceExportError(RuntimeError):
    pass


class ImmutableBrowserEvidenceExporter:
    def __init__(
        self,
        *,
        captures: BrowserEvidenceCaptureSource,
        artifacts: BrowserEvidenceArtifactRepository,
    ) -> None:
        self._captures = captures
        self._artifacts = artifacts

    async def export_failure(
        self,
        *,
        context_id: str,
        task: BrowserExecutionTask,
        result: BrowserScenarioResult,
    ) -> FailureEvidenceBundle:
        if any(
            _RESOURCE_ID.fullmatch(value) is None
            for value in (task.project_id, task.run_id, context_id)
        ):
            raise BrowserEvidenceExportError("browser evidence has an unsafe scope ID")
        if result.scenario_id != task.scenario.scenario_id:
            raise BrowserEvidenceExportError(
                "browser evidence result belongs to a different scenario"
            )
        if result.evaluation.passed:
            raise BrowserEvidenceExportError(
                "browser evidence export requires a failed result"
            )
        capture = BrowserFailureEvidenceCapture.model_validate(
            await self._captures.capture_failure(
                context_id=context_id,
                task=task,
                result=result,
            )
        )
        bundle = _compile_bundle(context_id=context_id, task=task, capture=capture)
        published = await self._artifacts.publish(bundle)
        references = tuple(pointer.object_name for pointer in published.artifacts)
        expected = tuple(document.object_name for document in bundle.documents)
        if references != expected:
            raise BrowserEvidenceExportError(
                "artifact repository returned incomplete browser evidence"
            )
        return FailureEvidenceBundle(
            trace_ref=references[0],
            accessibility_snapshot_ref=references[1],
            console_ref=references[2],
            network_ref=references[3],
            screenshot_ref=references[4],
        )


def _compile_bundle(
    *,
    context_id: str,
    task: BrowserExecutionTask,
    capture: BrowserFailureEvidenceCapture,
) -> BrowserEvidenceArtifactBundle:
    prefix = f"projects/{task.project_id}/runs/{task.run_id}/evidence/{context_id}"
    return BrowserEvidenceArtifactBundle(
        project_id=task.project_id,
        run_id=task.run_id,
        context_id=context_id,
        documents=(
            _document(f"{prefix}/trace.zip", "application/zip", capture.trace),
            _document(
                f"{prefix}/accessibility.md",
                "text/markdown; charset=utf-8",
                capture.accessibility_snapshot.encode(),
            ),
            _json_document(f"{prefix}/console.json", capture.console_events),
            _json_document(f"{prefix}/network.json", capture.network_events),
            _document(f"{prefix}/screenshot.png", "image/png", capture.screenshot),
        ),
    )


def _json_document(object_name: str, value: object) -> RunArtifactDocument:
    content = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return _document(object_name, "application/json", content)


def _document(
    object_name: str,
    content_type: str,
    content: bytes,
) -> RunArtifactDocument:
    return RunArtifactDocument(
        object_name=object_name,
        content_type=content_type,
        content=content,
        sha256=hashlib.sha256(content).hexdigest(),
    )


__all__ = [
    "BrowserEvidenceExportError",
    "BrowserFailureEvidenceCapture",
    "ImmutableBrowserEvidenceExporter",
]
