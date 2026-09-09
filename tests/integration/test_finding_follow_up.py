from __future__ import annotations

import httpx
import pytest

from app.cloud_tasks_dispatcher import task_id_for_job
from app.feature_worker_runtime import create_feature_worker_app
from app.finding_follow_up import (
    ExplainFindingJob,
    FindingFollowUpProcessor,
    InMemoryFindingFollowUpPublisher,
    SlackFindingFollowUpPublisher,
)
from app.run_artifact_repository import InMemoryRunArtifactRepository
from app.run_artifacts import compile_feature_run_artifacts
from app.slack_ingress import InMemoryJobRepository
from tests.integration.test_run_artifacts import _failed_run


def _job(*, finding_id: str) -> ExplainFindingJob:
    return ExplainFindingJob(
        job_id="slack:Ev-explain-profile",
        source_event_id="Ev-explain-profile",
        project_id="project-alpha",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.151000",
        finding_id=finding_id,
        request_text="<@U-QALI> explain finding",
    )


@pytest.mark.asyncio
async def test_follow_up_reads_immutable_artifacts_and_replies_in_origin_thread() -> (
    None
):
    record = await _failed_run()
    finding = record.investigations[0].finding
    assert finding is not None
    artifacts = InMemoryRunArtifactRepository()
    await artifacts.publish(compile_feature_run_artifacts(record))
    publisher = InMemoryFindingFollowUpPublisher()

    await FindingFollowUpProcessor(
        artifacts=artifacts,
        publisher=publisher,
        mock_mode=True,
    ).process(_job(finding_id=finding.finding_id))

    [published] = publisher.list_messages()
    assert published.channel_id == "C-QALI"
    assert published.thread_ts == "1788220800.151000"
    assert published.result.text.startswith(f"[MOCK MODE]\n{finding.finding_id}:")
    assert "Change and save the display name." in published.result.text
    assert "Expected: Updated Name" in published.result.text
    assert "Actual: Original Name" in published.result.text
    assert "evidence://initial/trace" in published.result.text
    assert "fingerprint" not in published.result.text.lower()


@pytest.mark.asyncio
async def test_follow_up_rejects_missing_finding_without_posting() -> None:
    record = await _failed_run()
    artifacts = InMemoryRunArtifactRepository()
    await artifacts.publish(compile_feature_run_artifacts(record))
    publisher = InMemoryFindingFollowUpPublisher()

    with pytest.raises(KeyError, match="finding-0000000000000000"):
        await FindingFollowUpProcessor(
            artifacts=artifacts,
            publisher=publisher,
            mock_mode=False,
        ).process(_job(finding_id="finding-0000000000000000"))

    assert publisher.list_messages() == []


@pytest.mark.asyncio
async def test_typed_follow_up_runs_through_authenticated_worker_boundary() -> None:
    record = await _failed_run()
    finding = record.investigations[0].finding
    assert finding is not None
    artifacts = InMemoryRunArtifactRepository()
    await artifacts.publish(compile_feature_run_artifacts(record))
    publisher = InMemoryFindingFollowUpPublisher()
    processor = FindingFollowUpProcessor(
        artifacts=artifacts,
        publisher=publisher,
        mock_mode=False,
    )
    job = _job(finding_id=finding.finding_id)
    jobs = InMemoryJobRepository()
    await jobs.create(job)
    app = create_feature_worker_app(
        queue_name="qali-jobs",
        jobs=jobs,
        progress=object(),
        tasks=object(),
        workflow=object(),
        finding_follow_ups=processor,
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        response = await client.post(
            "/internal/feature-jobs",
            content=job.model_dump_json(),
            headers={
                "Content-Type": "application/json",
                "X-CloudTasks-QueueName": "qali-jobs",
                "X-CloudTasks-TaskName": task_id_for_job(job.job_id),
                "X-CloudTasks-TaskExecutionCount": "0",
            },
        )

    assert response.status_code == 200
    assert await jobs.claim(job.job_id) is None
    assert len(publisher.list_messages()) == 1


@pytest.mark.asyncio
async def test_slack_follow_up_uses_a_stable_idempotency_key() -> None:
    class SlackClient:
        def __init__(self) -> None:
            self.messages = []

        async def chat_postMessage(self, **message):
            self.messages.append(message)

    record = await _failed_run()
    finding = record.investigations[0].finding
    assert finding is not None
    artifacts = InMemoryRunArtifactRepository()
    await artifacts.publish(compile_feature_run_artifacts(record))
    client = SlackClient()
    job = _job(finding_id=finding.finding_id)
    processor = FindingFollowUpProcessor(
        artifacts=artifacts,
        publisher=SlackFindingFollowUpPublisher(client=client),
        mock_mode=False,
    )

    await processor.process(job)
    await processor.process(job)

    assert len(client.messages) == 2
    assert client.messages[0] == client.messages[1]
    assert client.messages[0]["channel"] == job.channel_id
    assert client.messages[0]["thread_ts"] == job.thread_ts
    assert client.messages[0]["unfurl_links"] is False
    assert client.messages[0]["unfurl_media"] is False
    assert len(client.messages[0]["client_msg_id"]) == 36
