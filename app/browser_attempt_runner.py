from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.browser_executor_agent import BrowserExecutionTask, BrowserScenarioResult
from app.browser_facade import RestrictedBrowserSession
from app.failure_investigation import FailureAttempt, FailureEvidenceBundle


class BrowserAttemptContext(BaseModel):
    model_config = ConfigDict(
        frozen=True,
        extra="forbid",
        arbitrary_types_allowed=True,
    )

    context_id: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    session: RestrictedBrowserSession


class BrowserContextFactory(Protocol):
    async def create(self, task: BrowserExecutionTask) -> BrowserAttemptContext: ...


class BrowserExecutor(Protocol):
    async def execute(
        self,
        task: BrowserExecutionTask,
        *,
        session: RestrictedBrowserSession,
    ) -> BrowserScenarioResult: ...


class FailureEvidenceExporter(Protocol):
    async def export_failure(
        self,
        *,
        context_id: str,
        task: BrowserExecutionTask,
        result: BrowserScenarioResult,
    ) -> FailureEvidenceBundle: ...


class BrowserAttemptRunnerError(RuntimeError):
    pass


class BrowserAttemptRunner:
    def __init__(
        self,
        *,
        contexts: BrowserContextFactory,
        executor: BrowserExecutor,
        evidence: FailureEvidenceExporter,
    ) -> None:
        self._contexts = contexts
        self._executor = executor
        self._evidence = evidence
        self._used_context_ids: set[str] = set()

    async def execute(self, task: BrowserExecutionTask) -> FailureAttempt:
        context = BrowserAttemptContext.model_validate(
            await self._contexts.create(task)
        )
        if context.context_id in self._used_context_ids:
            raise BrowserAttemptRunnerError(
                "browser attempt requires a fresh isolated context"
            )
        self._used_context_ids.add(context.context_id)

        result = BrowserScenarioResult.model_validate(
            await self._executor.execute(task, session=context.session)
        )
        if result.scenario_id != task.scenario.scenario_id:
            raise BrowserAttemptRunnerError(
                "browser executor returned a result for a different scenario"
            )
        evidence = None
        if not result.evaluation.passed:
            evidence = FailureEvidenceBundle.model_validate(
                await self._evidence.export_failure(
                    context_id=context.context_id,
                    task=task,
                    result=result,
                )
            )
        return FailureAttempt(
            context_id=context.context_id,
            result=result,
            evidence=evidence,
        )


__all__ = [
    "BrowserAttemptContext",
    "BrowserAttemptRunner",
    "BrowserAttemptRunnerError",
]
