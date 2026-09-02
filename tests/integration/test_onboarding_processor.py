import pytest

from app.job_lifecycle import JobRetryReason
from app.onboarding_processor import OnboardingProgressProcessor
from app.slack_ingress import InMemoryJobRepository, OnboardProjectJob
from app.slack_progress import (
    InMemorySlackProgressReporter,
    OnboardingProgressStage,
)


class _RecordingOnboardingProcessor:
    def __init__(self) -> None:
        self.jobs: list[OnboardProjectJob] = []

    async def process(self, job: OnboardProjectJob) -> None:
        self.jobs.append(job)


class _FailingOnboardingProcessor:
    async def process(self, job: OnboardProjectJob) -> None:
        del job
        raise RuntimeError("synthetic onboarding failure")


class _FailOnceOnboardingProcessor:
    def __init__(self) -> None:
        self.attempts = 0

    async def process(self, job: OnboardProjectJob) -> None:
        del job
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("synthetic onboarding failure")


@pytest.mark.asyncio
async def test_onboarding_processor_reports_ready_in_the_originating_thread() -> None:
    jobs = InMemoryJobRepository()
    progress = InMemorySlackProgressReporter()
    delegate = _RecordingOnboardingProcessor()
    processor = OnboardingProgressProcessor(
        jobs=jobs,
        progress=progress,
        delegate=delegate,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-onboarding-progress",
        source_event_id="Ev-onboarding-progress",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.035000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    await jobs.claim(job.job_id)

    await processor.process(job)

    assert delegate.jobs == [job]
    [record] = progress.list_messages()
    assert record.message.channel_id == job.channel_id
    assert record.message.thread_ts == job.thread_ts
    assert record.stage is OnboardingProgressStage.READY
    assert await jobs.get_progress(job.job_id) == record.message


@pytest.mark.asyncio
async def test_onboarding_processor_reports_failure_before_retry_release() -> None:
    jobs = InMemoryJobRepository()
    progress = InMemorySlackProgressReporter()
    processor = OnboardingProgressProcessor(
        jobs=jobs,
        progress=progress,
        delegate=_FailingOnboardingProcessor(),
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-onboarding-progress-failure",
        source_event_id="Ev-onboarding-progress-failure",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.036000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    await jobs.claim(job.job_id)

    with pytest.raises(RuntimeError, match="synthetic onboarding failure"):
        await processor.process(job)

    [record] = progress.list_messages()
    assert record.stage is OnboardingProgressStage.FAILED
    assert await jobs.get_progress(job.job_id) == record.message


@pytest.mark.asyncio
async def test_onboarding_retry_reuses_the_durable_progress_message() -> None:
    jobs = InMemoryJobRepository()
    progress = InMemorySlackProgressReporter()
    delegate = _FailOnceOnboardingProcessor()
    processor = OnboardingProgressProcessor(
        jobs=jobs,
        progress=progress,
        delegate=delegate,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-onboarding-progress-retry",
        source_event_id="Ev-onboarding-progress-retry",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.037000",
        request_text="<@U-QALI> onboard project Example",
    )
    await jobs.create(job)
    await jobs.claim(job.job_id)

    with pytest.raises(RuntimeError, match="synthetic onboarding failure"):
        await processor.process(job)
    assert await jobs.release(job.job_id, reason=JobRetryReason.PROCESSOR_ERROR) is True
    await jobs.claim(job.job_id)

    await processor.process(job)

    assert delegate.attempts == 2
    [record] = progress.list_messages()
    assert record.stage is OnboardingProgressStage.READY
    assert await jobs.get_progress(job.job_id) == record.message
