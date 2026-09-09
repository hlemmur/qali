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

from app.browser_policy import BrowserActionKind, BrowserTargetPolicy
from app.cloud_tasks_dispatcher import task_id_for_job
from app.feature_context_loader import FeatureProjectContext
from app.firestore_project_repository import ProjectChannelBinding
from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
)
from app.knowledge_repository import KnowledgeArtifact
from app.knowledge_workflow import KnowledgeAnalysisTask, KnowledgeReview
from app.onboarding_source_flow import OnboardingSourceResult
from app.onboarding_worker_runtime import create_onboarding_worker_app
from app.raw_source_repository import RawSourceArtifact, RawSourceProvenance
from app.slack_ingress import InMemoryJobRepository, OnboardProjectJob
from app.slack_progress import (
    InMemorySlackProgressReporter,
    OnboardingProgressStage,
)
from app.source_text_extraction import KnowledgeSourceText
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


class _SourceFlow:
    async def ingest(self, job: OnboardProjectJob) -> OnboardingSourceResult:
        content = job.request_text.encode()
        return OnboardingSourceResult(
            project=ProjectChannelBinding(
                project_id="project-alpha",
                workspace_id=job.workspace_id,
                channel_id=job.channel_id,
                created_by=f"slack:{job.requester_user_id}",
            ),
            artifacts=(
                RawSourceArtifact(
                    project_id="project-alpha",
                    source_id="source-profile",
                    object_name="projects/project-alpha/raw/source-profile/source",
                    source_uri="slack://event/redacted",
                    source_uri_sha256="a" * 64,
                    content_type="text/plain",
                    sha256=hashlib.sha256(content).hexdigest(),
                    captured_at=datetime(2026, 9, 4, 15, 0, tzinfo=UTC),
                    provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
                    screening_scanners=("malware-v1", "instruction-v1"),
                ),
            ),
        )


class _SourceLoader:
    async def load(
        self,
        project_id: str,
        *,
        expected_generation: int,
    ) -> KnowledgeAnalysisTask:
        return KnowledgeAnalysisTask(
            project_id=project_id,
            sources=(
                KnowledgeSourceText(
                    source_id="source-profile",
                    content_type="text/plain",
                    text="Customers can edit profiles.",
                ),
            ),
            expected_generation=expected_generation,
        )


class _KnowledgeRepository:
    def __init__(self) -> None:
        self.artifact: KnowledgeArtifact | None = None

    async def publish(self, document, *, expected_generation: int):
        self.artifact = KnowledgeArtifact(
            project_id=document.project_id,
            object_name=f"projects/{document.project_id}/knowledge/index.md",
            sha256=document.sha256,
            generation=expected_generation + 1,
            updated_at=datetime(2026, 9, 4, 15, 5, tzinfo=UTC),
        )
        return self.artifact


class _FeatureContextRepository:
    def __init__(self) -> None:
        self.context: FeatureProjectContext | None = None
        self.expected_generation: int | None = None

    async def publish(
        self,
        context: FeatureProjectContext,
        *,
        expected_generation: int,
    ) -> object:
        self.context = context
        self.expected_generation = expected_generation
        return object()


@pytest.mark.asyncio
async def test_worker_runtime_completes_ready_onboarding_through_http() -> None:
    jobs = InMemoryJobRepository()
    progress = InMemorySlackProgressReporter()
    knowledge = _KnowledgeRepository()
    contexts = _FeatureContextRepository()
    job = OnboardProjectJob(
        job_id="slack:Ev-runtime-001",
        source_event_id="Ev-runtime-001",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788534000.001000",
        request_text="<@U-QALI> onboard project Customers can edit profiles.",
    )
    await jobs.create(job)
    app = create_onboarding_worker_app(
        settings=WorkerIngressSettings(queue_name="qali-jobs"),
        jobs=jobs,
        progress=progress,
        source_flow=_SourceFlow(),
        source_loader=_SourceLoader(),
        knowledge_repository=knowledge,
        feature_context_repository=contexts,
        target_policy=BrowserTargetPolicy(
            project_id="project-alpha",
            start_url="https://app.example.test/profile",
            allowed_origins=("https://app.example.test",),
            allowed_actions=(
                BrowserActionKind.NAVIGATE,
                BrowserActionKind.SNAPSHOT,
                BrowserActionKind.CLICK_REF,
                BrowserActionKind.TYPE_TEXT,
                BrowserActionKind.OBSERVE_ORACLE,
                BrowserActionKind.CAPTURE_EVIDENCE,
            ),
            credential_references=(),
            safe_consequential_actions=("save-profile",),
            max_steps=20,
            timeout_seconds=300,
        ),
        analyst_model=_StructuredModel(
            KnowledgeCompilation(
                project_id="project-alpha",
                overview="A profile application.",
                facts=(
                    KnowledgeFact(
                        statement="Customers can edit profiles.",
                        source_ids=("source-profile",),
                    ),
                ),
                contradictions=(),
                gaps=(),
                confidence=KnowledgeConfidence.HIGH,
            )
        ),
        reviewer_model=_StructuredModel(KnowledgeReview(approved=True, feedback=())),
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
    assert knowledge.artifact is not None
    assert knowledge.artifact.project_id == "project-alpha"
    assert contexts.expected_generation == 0
    assert contexts.context is not None
    assert contexts.context.project_id == "project-alpha"
    assert contexts.context.workspace_id == job.workspace_id
    assert contexts.context.channel_id == job.channel_id
    assert contexts.context.knowledge.overview == "A profile application."
    assert contexts.context.target_policy.start_url == (
        "https://app.example.test/profile"
    )
    [record] = progress.list_messages()
    assert record.stage is OnboardingProgressStage.READY
    assert await jobs.claim(job.job_id) is None
