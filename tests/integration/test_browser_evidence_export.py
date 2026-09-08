from __future__ import annotations

import pytest

from app.browser_evidence_export import (
    BrowserEvidenceExportError,
    BrowserFailureEvidenceCapture,
    ImmutableBrowserEvidenceExporter,
)
from app.run_artifact_repository import (
    InMemoryRunArtifactRepository,
    RunArtifactWriteConflict,
)
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_failure_investigation_workflow import _result


class _CaptureDouble:
    def __init__(self, capture: BrowserFailureEvidenceCapture) -> None:
        self.capture = capture
        self.calls = []

    async def capture_failure(self, *, context_id, task, result):
        self.calls.append((context_id, task, result))
        return self.capture


@pytest.mark.asyncio
async def test_failed_attempt_exports_all_evidence_under_its_owning_run() -> None:
    task = _execution_task().model_copy(update={"run_id": "run-evidence-001"})
    result = _result(passed=False)
    capture = BrowserFailureEvidenceCapture(
        trace=b"trace archive",
        accessibility_snapshot="# Accessibility snapshot\n\nbutton Submit\n",
        console_events=({"level": "error", "text": "request failed"},),
        network_events=({"method": "POST", "status": 500},),
        screenshot=b"png image",
    )
    source = _CaptureDouble(capture)
    repository = InMemoryRunArtifactRepository()
    exporter = ImmutableBrowserEvidenceExporter(
        captures=source,
        artifacts=repository,
    )

    evidence = await exporter.export_failure(
        context_id="context-failure-001",
        task=task,
        result=result,
    )

    prefix = (
        f"projects/{task.project_id}/runs/{task.run_id}/evidence/context-failure-001"
    )
    assert evidence.references() == (
        f"{prefix}/trace.zip",
        f"{prefix}/accessibility.md",
        f"{prefix}/console.json",
        f"{prefix}/network.json",
        f"{prefix}/screenshot.png",
    )
    assert source.calls == [("context-failure-001", task, result)]
    assert (await repository.read(evidence.trace_ref)).content == b"trace archive"
    assert (
        await repository.read(evidence.accessibility_snapshot_ref)
    ).content == b"# Accessibility snapshot\n\nbutton Submit\n"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("context_id", "result", "error"),
    [
        ("../unsafe", _result(passed=False), "unsafe scope"),
        ("context-pass-001", _result(passed=True), "failed result"),
        (
            "context-wrong-scenario-001",
            _result(passed=False).model_copy(update={"scenario_id": "scenario-other"}),
            "different scenario",
        ),
    ],
)
async def test_invalid_failure_scope_is_rejected_before_capture(
    context_id, result, error
) -> None:
    task = _execution_task()
    source = _CaptureDouble(
        BrowserFailureEvidenceCapture(
            trace=b"trace",
            accessibility_snapshot="snapshot",
            console_events=(),
            network_events=(),
            screenshot=b"screenshot",
        )
    )
    exporter = ImmutableBrowserEvidenceExporter(
        captures=source,
        artifacts=InMemoryRunArtifactRepository(),
    )

    with pytest.raises(BrowserEvidenceExportError, match=error):
        await exporter.export_failure(
            context_id=context_id,
            task=task,
            result=result,
        )

    assert source.calls == []


@pytest.mark.asyncio
async def test_evidence_retry_is_idempotent_but_changed_content_is_rejected() -> None:
    task = _execution_task()
    result = _result(passed=False)
    original = BrowserFailureEvidenceCapture(
        trace=b"trace",
        accessibility_snapshot="snapshot",
        console_events=(),
        network_events=(),
        screenshot=b"screenshot",
    )
    source = _CaptureDouble(original)
    repository = InMemoryRunArtifactRepository()
    exporter = ImmutableBrowserEvidenceExporter(
        captures=source,
        artifacts=repository,
    )

    first = await exporter.export_failure(
        context_id="context-retry-001", task=task, result=result
    )
    retry = await exporter.export_failure(
        context_id="context-retry-001", task=task, result=result
    )
    assert retry == first

    source.capture = original.model_copy(update={"screenshot": b"changed screenshot"})
    with pytest.raises(RunArtifactWriteConflict):
        await exporter.export_failure(
            context_id="context-retry-001", task=task, result=result
        )


@pytest.mark.asyncio
async def test_unsafe_project_scope_is_rejected_before_capture() -> None:
    task = _execution_task().model_copy(update={"project_id": "../project"})
    source = _CaptureDouble(
        BrowserFailureEvidenceCapture(
            trace=b"trace",
            accessibility_snapshot="snapshot",
            console_events=(),
            network_events=(),
            screenshot=b"screenshot",
        )
    )
    exporter = ImmutableBrowserEvidenceExporter(
        captures=source,
        artifacts=InMemoryRunArtifactRepository(),
    )

    with pytest.raises(BrowserEvidenceExportError, match="unsafe scope"):
        await exporter.export_failure(
            context_id="context-safe-001",
            task=task,
            result=_result(passed=False),
        )

    assert source.calls == []
