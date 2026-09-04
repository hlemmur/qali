from __future__ import annotations

from typing import Protocol

from app.knowledge_quality import KnowledgeReadiness
from app.slack_ingress import OnboardProjectJob
from app.slack_progress import (
    OnboardingProgressStage,
    ProgressMessage,
)


class ProgressRepository(Protocol):
    async def attach_progress(
        self,
        job_id: str,
        message: ProgressMessage,
    ) -> bool: ...

    async def get_progress(self, job_id: str) -> ProgressMessage | None: ...


class ProgressReporter(Protocol):
    async def start(self, job: OnboardProjectJob) -> ProgressMessage: ...

    async def update(
        self,
        message: ProgressMessage,
        stage: OnboardingProgressStage,
    ) -> None: ...


class OnboardingProcessor(Protocol):
    async def process(
        self,
        job: OnboardProjectJob,
    ) -> KnowledgeReadiness | None: ...


class OnboardingProgressProcessor:
    def __init__(
        self,
        *,
        jobs: ProgressRepository,
        progress: ProgressReporter,
        delegate: OnboardingProcessor,
    ) -> None:
        self._jobs = jobs
        self._progress = progress
        self._delegate = delegate

    async def process(self, job: OnboardProjectJob) -> None:
        message = await self._jobs.get_progress(job.job_id)
        if message is None:
            message = await self._progress.start(job)
            if not await self._jobs.attach_progress(job.job_id, message):
                raise RuntimeError("could not attach onboarding progress message")
        await self._progress.update(
            message,
            OnboardingProgressStage.REVIEWING_SOURCES,
        )
        try:
            readiness = await self._delegate.process(job)
        except Exception:
            await self._progress.update(message, OnboardingProgressStage.FAILED)
            raise
        final_stage = (
            OnboardingProgressStage.INSUFFICIENT_KNOWLEDGE
            if readiness is KnowledgeReadiness.INSUFFICIENT
            else OnboardingProgressStage.READY
        )
        await self._progress.update(message, final_stage)


__all__ = ["OnboardingProgressProcessor"]
