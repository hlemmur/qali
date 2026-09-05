from __future__ import annotations

import hashlib
from collections.abc import AsyncGenerator
from datetime import UTC, datetime

import httpx
import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import BaseModel

from app.cloud_tasks_dispatcher import task_id_for_job
from app.firestore_project_repository import ProjectChannelBinding
from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
)
from app.knowledge_repository import KnowledgeArtifact
from app.knowledge_workflow import KnowledgeReview
from app.onboarding_runtime import OnboardingRuntimeSettings, create_onboarding_runtime
from app.raw_source_repository import (
    RawSourceArtifact,
    RawSourceProvenance,
    RawSourceSnapshot,
)
from app.slack_file_client import SlackFileClientSettings
from app.slack_file_fetcher import SlackFilePayload
from app.slack_ingress import (
    InMemoryJobRepository,
    OnboardProjectJob,
    SlackFileReference,
)
from app.slack_progress import InMemorySlackProgressReporter, OnboardingProgressStage
from app.source_fetcher import SourceHttpResponse
from app.source_malware_scanner import ClamAvSettings
from app.source_runtime import SourceRuntimeSettings
from app.source_screening import ScreenedSource
from app.worker_ingress import WorkerIngressSettings


class _StructuredModel(BaseLlm):
    response: BaseModel

    def __init__(self, response: BaseModel) -> None:
        super().__init__(model="test-structured-model", response=response)

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        del llm_request
        assert stream is False
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text=self.response.model_dump_json())],
            )
        )


class _ProjectRepository:
    async def resolve_or_create(self, **kwargs: str) -> ProjectChannelBinding:
        return ProjectChannelBinding(
            project_id="project-alpha",
            workspace_id=kwargs["workspace_id"],
            channel_id=kwargs["channel_id"],
            created_by=kwargs["created_by"],
        )


class _PublicResolver:
    async def resolve(self, hostname: str, port: int) -> list[str]:
        assert (hostname, port) == ("docs.example.test", 443)
        return ["93.184.216.34"]


class _SourceTransport:
    async def get(
        self,
        url: str,
        *,
        approved_addresses: tuple[str, ...],
        max_bytes: int,
    ) -> SourceHttpResponse:
        assert url == "https://docs.example.test/profile.md"
        assert approved_addresses == ("93.184.216.34",)
        assert max_bytes == 4096
        return SourceHttpResponse(
            status_code=200,
            headers={"content-type": "text/markdown"},
            body=b"# Profile\nCustomers can edit their display name.",
        )


class _CleanClamAvRunner:
    async def scan(self, content: bytes) -> int:
        assert content in {
            b"# Profile\nCustomers can edit their display name.",
            b"Users can export reports.",
        }
        return 0


class _SlackFileClient:
    async def download(self, file_id: str, *, max_bytes: int) -> SlackFilePayload:
        assert file_id == "F-REPORT"
        assert max_bytes == 25
        return SlackFilePayload(
            file_id=file_id,
            name="reports.txt",
            media_type="text/plain",
            size_bytes=25,
            content=b"Users can export reports.",
        )


class _SourceStore:
    def __init__(self) -> None:
        self._snapshots: dict[str, RawSourceSnapshot] = {}
        self._artifacts: list[RawSourceArtifact] = []

    async def persist(
        self,
        *,
        project_id: str,
        source_id: str,
        source: ScreenedSource,
        provenance: RawSourceProvenance,
    ) -> RawSourceArtifact:
        artifact = RawSourceArtifact(
            project_id=project_id,
            source_id=source_id,
            object_name=f"projects/{project_id}/raw/{source_id}/source",
            source_uri=source.source.url,
            source_uri_sha256=hashlib.sha256(source.source.url.encode()).hexdigest(),
            content_type=source.source.content_type,
            sha256=hashlib.sha256(source.source.content).hexdigest(),
            captured_at=datetime(2026, 9, 4, 19, 15, tzinfo=UTC),
            provenance=provenance,
            screening_scanners=tuple(item.scanner for item in source.decisions),
        )
        self._snapshots[artifact.object_name] = RawSourceSnapshot(
            artifact=artifact,
            content=source.source.content,
        )
        return artifact

    async def create(self, artifact: RawSourceArtifact) -> bool:
        self._artifacts.append(artifact)
        return True

    async def list_for_project(
        self,
        project_id: str,
    ) -> tuple[RawSourceArtifact, ...]:
        return tuple(
            artifact
            for artifact in self._artifacts
            if artifact.project_id == project_id
        )

    async def read(self, artifact: RawSourceArtifact) -> RawSourceSnapshot:
        return self._snapshots[artifact.object_name]


class _KnowledgeRepository:
    def __init__(self) -> None:
        self.artifact: KnowledgeArtifact | None = None

    async def publish(self, document, *, expected_generation: int):
        self.artifact = KnowledgeArtifact(
            project_id=document.project_id,
            object_name=f"projects/{document.project_id}/knowledge/index.md",
            sha256=document.sha256,
            generation=expected_generation + 1,
            updated_at=datetime(2026, 9, 4, 19, 20, tzinfo=UTC),
        )
        return self.artifact


@pytest.mark.asyncio
async def test_runtime_completes_bounded_screened_onboarding_through_http() -> None:
    source_event_id = "Ev-full-runtime"
    url_source_id = (
        "slack-url-"
        + hashlib.sha256(
            f"{source_event_id}\0https://docs.example.test/profile.md".encode()
        ).hexdigest()[:32]
    )
    file_source_id = (
        "slack-file-"
        + hashlib.sha256(f"{source_event_id}\0F-REPORT".encode()).hexdigest()[:32]
    )
    jobs = InMemoryJobRepository()
    progress = InMemorySlackProgressReporter()
    sources = _SourceStore()
    knowledge = _KnowledgeRepository()
    job = OnboardProjectJob(
        job_id=f"slack:{source_event_id}",
        source_event_id=source_event_id,
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788550200.001000",
        request_text=("<@U-QALI> onboard project https://docs.example.test/profile.md"),
        files=(
            SlackFileReference(
                file_id="F-REPORT",
                name="reports.txt",
                media_type="text/plain",
                size_bytes=25,
            ),
        ),
    )
    await jobs.create(job)
    app = create_onboarding_runtime(
        settings=OnboardingRuntimeSettings(
            worker=WorkerIngressSettings(queue_name="qali-jobs"),
            source=SourceRuntimeSettings(
                allowed_origins=("https://docs.example.test",),
                max_bytes=4096,
            ),
            clamav=ClamAvSettings(scanner_id="clamav-engine-1-signatures-20260904"),
            slack_files=SlackFileClientSettings(token="xoxb-test-token"),
        ),
        jobs=jobs,
        progress=progress,
        projects=_ProjectRepository(),
        raw_sources=sources,
        source_index=sources,
        knowledge_repository=knowledge,
        analyst_model=_StructuredModel(
            KnowledgeCompilation(
                project_id="project-alpha",
                overview="A profile application.",
                facts=(
                    KnowledgeFact(
                        statement="Customers can edit their display name.",
                        source_ids=(url_source_id,),
                    ),
                    KnowledgeFact(
                        statement="Users can export reports.",
                        source_ids=(file_source_id,),
                    ),
                ),
                contradictions=(),
                gaps=(),
                confidence=KnowledgeConfidence.HIGH,
            )
        ),
        reviewer_model=_StructuredModel(KnowledgeReview(approved=True, feedback=())),
        resolver=_PublicResolver(),
        transport=_SourceTransport(),
        clamav_runner=_CleanClamAvRunner(),
        slack_file_client=_SlackFileClient(),
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        response = await client.post(
            "/internal/jobs",
            content=job.model_dump_json(),
            headers={
                "Content-Type": "application/json",
                "X-CloudTasks-QueueName": "qali-jobs",
                "X-CloudTasks-TaskName": task_id_for_job(job.job_id),
                "X-CloudTasks-TaskExecutionCount": "0",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    artifacts = await sources.list_for_project("project-alpha")
    assert {artifact.source_id for artifact in artifacts} == {
        url_source_id,
        file_source_id,
    }
    assert all(
        artifact.screening_scanners
        == (
            "clamav-engine-1-signatures-20260904",
            "qali-deterministic-instruction-v1",
        )
        for artifact in artifacts
    )
    assert knowledge.artifact is not None
    assert knowledge.artifact.project_id == "project-alpha"
    [record] = progress.list_messages()
    assert record.stage is OnboardingProgressStage.READY
    assert await jobs.claim(job.job_id) is None
