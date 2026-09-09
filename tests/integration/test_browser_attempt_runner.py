from __future__ import annotations

import pytest

from app.browser_attempt_runner import (
    BrowserAttemptContext,
    BrowserAttemptRunner,
    BrowserAttemptRunnerError,
)
from app.browser_facade import RestrictedBrowserSession
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_browser_facade import (
    _BackendDouble,
    _CredentialResolverDouble,
)
from tests.integration.test_failure_investigation_workflow import _evidence, _result


class _ContextFactoryDouble:
    def __init__(self, contexts: list[BrowserAttemptContext]) -> None:
        self._contexts = iter(contexts)
        self.tasks = []

    async def create(self, task):
        self.tasks.append(task)
        return next(self._contexts)


class _ExecutorDouble:
    def __init__(self, results) -> None:
        self._results = iter(results)
        self.calls = []

    async def execute(self, task, *, session):
        self.calls.append((task, session))
        return next(self._results)


class _EvidenceExporterDouble:
    def __init__(self, evidence) -> None:
        self.evidence = evidence
        self.calls = []

    async def export_failure(self, *, context_id, task, result):
        self.calls.append((context_id, task, result))
        return self.evidence


class _FailingEvidenceExporter:
    async def export_failure(self, *, context_id, task, result):
        del context_id, task, result
        raise RuntimeError("evidence export unavailable")


def _context(context_id: str) -> BrowserAttemptContext:
    task = _execution_task()
    return BrowserAttemptContext(
        context_id=context_id,
        session=RestrictedBrowserSession(
            policy=task.target_policy,
            approved_oracles=(
                *task.scenario.positive_oracles,
                *task.scenario.forbidden_state_oracles,
            ),
            backend=_BackendDouble(),
            credentials=_CredentialResolverDouble(),
        ),
    )


@pytest.mark.asyncio
async def test_passing_attempt_uses_a_fresh_context_without_failure_evidence() -> None:
    task = _execution_task()
    context = _context("context-pass-001")
    factory = _ContextFactoryDouble([context])
    executor = _ExecutorDouble([_result(passed=True)])
    exporter = _EvidenceExporterDouble(_evidence("unused"))
    runner = BrowserAttemptRunner(
        contexts=factory,
        executor=executor,
        evidence=exporter,
    )

    attempt = await runner.execute(task)

    assert attempt.context_id == context.context_id
    assert attempt.result.evaluation.passed is True
    assert attempt.evidence is None
    assert factory.tasks == [task]
    assert executor.calls == [(task, context.session)]
    assert exporter.calls == []


@pytest.mark.asyncio
async def test_failed_attempt_requires_the_complete_exported_evidence_bundle() -> None:
    task = _execution_task()
    context = _context("context-failure-001")
    result = _result(passed=False)
    exporter = _EvidenceExporterDouble(_evidence("initial"))
    runner = BrowserAttemptRunner(
        contexts=_ContextFactoryDouble([context]),
        executor=_ExecutorDouble([result]),
        evidence=exporter,
    )

    attempt = await runner.execute(task)

    assert attempt.context_id == context.context_id
    assert attempt.result == result
    assert attempt.evidence == _evidence("initial")
    assert exporter.calls == [(context.context_id, task, result)]


@pytest.mark.asyncio
async def test_evidence_export_failure_cannot_return_an_incomplete_attempt() -> None:
    runner = BrowserAttemptRunner(
        contexts=_ContextFactoryDouble([_context("context-failure-002")]),
        executor=_ExecutorDouble([_result(passed=False)]),
        evidence=_FailingEvidenceExporter(),
    )

    with pytest.raises(RuntimeError, match="export unavailable"):
        await runner.execute(_execution_task())


@pytest.mark.asyncio
async def test_context_id_cannot_be_reused_for_a_later_attempt() -> None:
    task = _execution_task()
    context = _context("context-reused-001")
    executor = _ExecutorDouble([_result(passed=True), _result(passed=True)])
    runner = BrowserAttemptRunner(
        contexts=_ContextFactoryDouble([context, context]),
        executor=executor,
        evidence=_EvidenceExporterDouble(_evidence("unused")),
    )

    await runner.execute(task)
    with pytest.raises(BrowserAttemptRunnerError, match="fresh isolated context"):
        await runner.execute(task)

    assert len(executor.calls) == 1


@pytest.mark.asyncio
async def test_failure_reproduction_uses_the_same_guarded_attempt_path() -> None:
    task = _execution_task()
    initial = _context("context-initial-001")
    reproduction = _context("context-reproduction-001")
    result = _result(passed=False)
    exporter = _EvidenceExporterDouble(_evidence("failure"))
    runner = BrowserAttemptRunner(
        contexts=_ContextFactoryDouble([initial, reproduction]),
        executor=_ExecutorDouble([result, result]),
        evidence=exporter,
    )

    initial_attempt = await runner.execute(task)
    reproduced_attempt = await runner.reproduce(task)

    assert initial_attempt.context_id == initial.context_id
    assert reproduced_attempt.context_id == reproduction.context_id
    assert reproduced_attempt.result == result
    assert reproduced_attempt.evidence == _evidence("failure")


@pytest.mark.asyncio
async def test_executor_cannot_substitute_another_scenario_result() -> None:
    task = _execution_task()
    substituted = _result(passed=True).model_copy(
        update={"scenario_id": "scenario-other"}
    )
    exporter = _EvidenceExporterDouble(_evidence("unused"))
    runner = BrowserAttemptRunner(
        contexts=_ContextFactoryDouble([_context("context-substitute-001")]),
        executor=_ExecutorDouble([substituted]),
        evidence=exporter,
    )

    with pytest.raises(BrowserAttemptRunnerError, match="different scenario"):
        await runner.execute(task)

    assert exporter.calls == []
