from __future__ import annotations

from typing import Protocol

from app.job_lifecycle import JobRetryReason
from app.slack_ingress import OnboardProjectJob


class JobLifecycleRepository(Protocol):
    async def claim(self, job_id: str) -> OnboardProjectJob | None: ...

    async def complete(self, job_id: str) -> bool: ...

    async def release(self, job_id: str, *, reason: JobRetryReason) -> bool: ...


class JobProcessor(Protocol):
    async def process(self, job: OnboardProjectJob) -> None: ...


class LifecycleJobHandler:
    def __init__(
        self,
        *,
        jobs: JobLifecycleRepository,
        processor: JobProcessor,
    ) -> None:
        self._jobs = jobs
        self._processor = processor

    async def handle(self, job: OnboardProjectJob) -> None:
        claimed_job = await self._jobs.claim(job.job_id)
        if claimed_job is None:
            return
        try:
            await self._processor.process(claimed_job)
        except Exception:
            await self._jobs.release(
                claimed_job.job_id,
                reason=JobRetryReason.PROCESSOR_ERROR,
            )
            raise
        await self._jobs.complete(claimed_job.job_id)


__all__ = [
    "JobLifecycleRepository",
    "JobProcessor",
    "LifecycleJobHandler",
]
