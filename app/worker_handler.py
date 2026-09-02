from __future__ import annotations

import asyncio
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.job_lifecycle import JobFailureReason, JobRetryReason
from app.slack_ingress import OnboardProjectJob


class JobExecutionSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    timeout_seconds: float = Field(default=900, gt=0, le=900)
    max_delivery_attempts: int = Field(default=3, ge=2)


class JobLifecycleRepository(Protocol):
    async def claim(self, job_id: str) -> OnboardProjectJob | None: ...

    async def complete(self, job_id: str) -> bool: ...

    async def release(self, job_id: str, *, reason: JobRetryReason) -> bool: ...

    async def fail(self, job_id: str, *, reason: JobFailureReason) -> bool: ...


class JobProcessor(Protocol):
    async def process(self, job: OnboardProjectJob) -> None: ...


class LifecycleJobHandler:
    def __init__(
        self,
        *,
        jobs: JobLifecycleRepository,
        processor: JobProcessor,
        settings: JobExecutionSettings | None = None,
    ) -> None:
        self._jobs = jobs
        self._processor = processor
        self._settings = settings or JobExecutionSettings()

    async def handle(
        self,
        job: OnboardProjectJob,
        *,
        execution_count: int = 0,
    ) -> None:
        claimed_job = await self._jobs.claim(job.job_id)
        if claimed_job is None:
            return
        if execution_count >= self._settings.max_delivery_attempts - 1:
            await self._jobs.fail(
                claimed_job.job_id,
                reason=JobFailureReason.RETRY_EXHAUSTED,
            )
            return
        try:
            async with asyncio.timeout(self._settings.timeout_seconds):
                await self._processor.process(claimed_job)
        except asyncio.CancelledError:
            await asyncio.shield(
                self._jobs.release(
                    claimed_job.job_id,
                    reason=JobRetryReason.CANCELLED,
                )
            )
            raise
        except TimeoutError:
            await self._jobs.release(
                claimed_job.job_id,
                reason=JobRetryReason.TIMEOUT,
            )
            raise
        except Exception:
            await self._jobs.release(
                claimed_job.job_id,
                reason=JobRetryReason.PROCESSOR_ERROR,
            )
            raise
        await self._jobs.complete(claimed_job.job_id)


__all__ = [
    "JobExecutionSettings",
    "JobLifecycleRepository",
    "JobProcessor",
    "LifecycleJobHandler",
]
