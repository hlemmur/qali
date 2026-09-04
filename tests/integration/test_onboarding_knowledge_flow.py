from __future__ import annotations

import hashlib
from datetime import UTC, datetime

import pytest

from app.firestore_project_repository import ProjectChannelBinding
from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
    KnowledgeReadiness,
)
from app.knowledge_repository import KnowledgeArtifact
from app.knowledge_source_loader import KnowledgeSourceLoader
from app.knowledge_workflow import (
    KnowledgeAnalysisTask,
    KnowledgeReview,
    KnowledgeReviewTask,
    KnowledgeWorkflow,
)
from app.onboarding_knowledge_flow import (
    OnboardingKnowledgeFlow,
    OnboardingKnowledgeIntegrityError,
)
from app.onboarding_processor import OnboardingProgressProcessor
from app.onboarding_source_flow import OnboardingSourceFlow
from app.raw_source_repository import (
    RawSourceArtifact,
    RawSourceProvenance,
    RawSourceSnapshot,
)
from app.slack_ingress import InMemoryJobRepository, OnboardProjectJob
from app.slack_progress import (
    InMemorySlackProgressReporter,
    OnboardingProgressStage,
)
from app.source_fetcher import FetchedSource
from app.source_ingestion import OnboardingSourceIngestionService
from app.source_screening import (
    ScreenedSource,
    SourceScreeningDecision,
    SourceScreeningService,
    SourceScreeningStage,
)
from app.source_text_extraction import SourceTextExtractor


class _ProjectRepository:
    async def resolve_or_create(self, **kwargs: str) -> ProjectChannelBinding:
        return ProjectChannelBinding(
            project_id="project-alpha",
            workspace_id=kwargs["workspace_id"],
            channel_id=kwargs["channel_id"],
            created_by=kwargs["created_by"],
        )


class _NeverNetworkFetcher:
    async def fetch(self, url: str) -> FetchedSource:
        raise AssertionError(f"unexpected network fetch: {url}")


class _AllowScanner:
    def __init__(self, stage: SourceScreeningStage) -> None:
        self._stage = stage

    async def scan(self, source: FetchedSource) -> SourceScreeningDecision:
        del source
        return SourceScreeningDecision(
            stage=self._stage,
            scanner=f"test-{self._stage.value}-scanner",
            threats=(),
        )


class _InMemorySourceStore:
    def __init__(self, *, omit_new_from_index: bool = False) -> None:
        self._snapshots: dict[str, RawSourceSnapshot] = {}
        self._indexed: list[RawSourceArtifact] = []
        self._omit_new_from_index = omit_new_from_index

    def seed(self, source_id: str, content: bytes) -> None:
        artifact = RawSourceArtifact(
            project_id="project-alpha",
            source_id=source_id,
            object_name=f"projects/project-alpha/raw/{source_id}/source",
            source_uri="https://docs.example.test/existing.txt",
            source_uri_sha256="c" * 64,
            content_type="text/plain",
            sha256=hashlib.sha256(content).hexdigest(),
            captured_at=datetime(2026, 9, 4, 9, 0, tzinfo=UTC),
            provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
            screening_scanners=("malware-v1", "instruction-v1"),
        )
        self._snapshots[source_id] = RawSourceSnapshot(
            artifact=artifact,
            content=content,
        )
        self._indexed.append(artifact)

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
            captured_at=datetime(2026, 9, 4, 10, 0, tzinfo=UTC),
            provenance=provenance,
            screening_scanners=tuple(decision.scanner for decision in source.decisions),
        )
        self._snapshots[source_id] = RawSourceSnapshot(
            artifact=artifact,
            content=source.source.content,
        )
        return artifact

    async def create(self, artifact: RawSourceArtifact) -> bool:
        if not self._omit_new_from_index:
            self._indexed.append(artifact)
        return True

    async def list_for_project(
        self,
        project_id: str,
    ) -> tuple[RawSourceArtifact, ...]:
        return tuple(
            artifact for artifact in self._indexed if artifact.project_id == project_id
        )

    async def read(self, artifact: RawSourceArtifact) -> RawSourceSnapshot:
        return self._snapshots[artifact.source_id]


class _KnowledgeAnalyst:
    async def compile(self, task: KnowledgeAnalysisTask) -> KnowledgeCompilation:
        return KnowledgeCompilation(
            project_id=task.project_id,
            overview="A profile application.",
            facts=(
                KnowledgeFact(
                    statement="Customers can edit profiles.",
                    source_ids=(task.sources[0].source_id,),
                ),
            ),
            contradictions=(),
            gaps=(),
            confidence=KnowledgeConfidence.HIGH,
        )

    async def revise(
        self,
        task: KnowledgeAnalysisTask,
        prior: KnowledgeCompilation,
        feedback: tuple[str, ...],
    ) -> KnowledgeCompilation:
        del task, prior, feedback
        raise AssertionError("unexpected knowledge revision")


class _KnowledgeReviewer:
    async def review(self, task: KnowledgeReviewTask) -> KnowledgeReview:
        del task
        return KnowledgeReview(approved=True, feedback=())


class _KnowledgeRepository:
    async def publish(self, document, *, expected_generation: int):
        return KnowledgeArtifact(
            project_id=document.project_id,
            object_name=f"projects/{document.project_id}/knowledge/index.md",
            sha256=document.sha256,
            generation=expected_generation + 1,
            updated_at=datetime(2026, 9, 4, 10, 5, tzinfo=UTC),
        )


class _MissingKnowledgeRepository:
    async def publish(self, document, *, expected_generation: int):
        del document, expected_generation
        return None


def _job() -> OnboardProjectJob:
    return OnboardProjectJob(
        job_id="slack:Ev-knowledge-graph",
        source_event_id="Ev-knowledge-graph",
        workspace_id="T-QALI",
        channel_id="C-PROJECT",
        requester_user_id="U-OWNER",
        thread_ts="1788516000.001000",
        request_text=("<@U-QALI> onboard project Customers can edit profiles."),
    )


def _flow(
    source_store: _InMemorySourceStore,
    *,
    knowledge_repository=None,
) -> OnboardingKnowledgeFlow:
    source_ingestion = OnboardingSourceIngestionService(
        fetcher=_NeverNetworkFetcher(),
        screener=SourceScreeningService(
            malware_scanner=_AllowScanner(SourceScreeningStage.MALWARE),
            instruction_scanner=_AllowScanner(SourceScreeningStage.INSTRUCTION),
        ),
        raw_repository=source_store,
        source_index=source_store,
    )
    return OnboardingKnowledgeFlow(
        source_flow=OnboardingSourceFlow(
            projects=_ProjectRepository(),
            ingestion=source_ingestion,
        ),
        source_loader=KnowledgeSourceLoader(
            source_index=source_store,
            raw_sources=source_store,
            extractor=SourceTextExtractor(),
        ),
        knowledge_workflow=KnowledgeWorkflow(
            analyst=_KnowledgeAnalyst(),
            reviewer=_KnowledgeReviewer(),
            repository=knowledge_repository or _KnowledgeRepository(),
        ),
    )


@pytest.mark.asyncio
async def test_onboarding_builds_ready_knowledge_from_persisted_sources() -> None:
    source_store = _InMemorySourceStore()

    result = await _flow(source_store).run(_job(), expected_generation=0)

    assert result.source_result.project.project_id == "project-alpha"
    assert result.analysis_task.sources[0].text == ("Customers can edit profiles.")
    assert result.knowledge.decision.readiness is KnowledgeReadiness.READY
    assert result.knowledge.artifact is not None
    assert result.knowledge.artifact.generation == 1
    assert result.source_result.artifacts[0].source_id == (
        result.analysis_task.sources[0].source_id
    )


@pytest.mark.asyncio
async def test_newly_ingested_source_must_be_visible_to_knowledge_analysis() -> None:
    source_store = _InMemorySourceStore(omit_new_from_index=True)
    source_store.seed("existing-source", b"Existing project information.")

    with pytest.raises(OnboardingKnowledgeIntegrityError) as caught:
        await _flow(source_store).run(_job(), expected_generation=0)

    assert str(caught.value) == "onboarding knowledge graph integrity failed"


@pytest.mark.asyncio
async def test_worker_progress_reports_ready_for_published_knowledge() -> None:
    source_store = _InMemorySourceStore()
    jobs = InMemoryJobRepository()
    progress = InMemorySlackProgressReporter()
    processor = OnboardingProgressProcessor(
        jobs=jobs,
        progress=progress,
        delegate=_flow(source_store),
    )
    job = _job()
    await jobs.create(job)
    await jobs.claim(job.job_id)

    await processor.process(job)

    [record] = progress.list_messages()
    assert record.stage is OnboardingProgressStage.READY


@pytest.mark.asyncio
async def test_worker_never_reports_ready_without_a_published_artifact() -> None:
    flow = _flow(
        _InMemorySourceStore(),
        knowledge_repository=_MissingKnowledgeRepository(),
    )

    with pytest.raises(OnboardingKnowledgeIntegrityError):
        await flow.process(_job())
