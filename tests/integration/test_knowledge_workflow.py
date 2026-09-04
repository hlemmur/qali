from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
    KnowledgeGap,
    KnowledgeReadiness,
)
from app.knowledge_repository import KnowledgeArtifact
from app.knowledge_workflow import (
    KnowledgeAnalysisTask,
    KnowledgeReview,
    KnowledgeReviewRejected,
    KnowledgeReviewTask,
    KnowledgeWorkflow,
)
from app.source_text_extraction import KnowledgeSourceText


class _KnowledgeAnalystDouble:
    def __init__(self, drafts: list[KnowledgeCompilation]) -> None:
        self._drafts = iter(drafts)
        self.tasks: list[KnowledgeAnalysisTask] = []
        self.revisions: list[tuple[KnowledgeCompilation, tuple[str, ...]]] = []

    async def compile(self, task: KnowledgeAnalysisTask) -> KnowledgeCompilation:
        self.tasks.append(task)
        return next(self._drafts)

    async def revise(
        self,
        task: KnowledgeAnalysisTask,
        prior: KnowledgeCompilation,
        feedback: tuple[str, ...],
    ) -> KnowledgeCompilation:
        assert task == self.tasks[0]
        self.revisions.append((prior, feedback))
        return next(self._drafts)


class _KnowledgeReviewerDouble:
    def __init__(self, reviews: list[KnowledgeReview]) -> None:
        self._reviews = iter(reviews)
        self.tasks: list[KnowledgeReviewTask] = []

    async def review(self, task: KnowledgeReviewTask) -> KnowledgeReview:
        self.tasks.append(task)
        return next(self._reviews)


class _KnowledgeRepositoryDouble:
    def __init__(self) -> None:
        self.calls: list[tuple[bytes, int]] = []

    async def publish(self, document, *, expected_generation: int):
        self.calls.append((document.content, expected_generation))
        return KnowledgeArtifact(
            project_id=document.project_id,
            object_name=f"projects/{document.project_id}/knowledge/index.md",
            sha256=document.sha256,
            generation=expected_generation + 1,
            updated_at=datetime(2026, 9, 4, 2, 30, tzinfo=UTC),
        )


def _sources() -> tuple[KnowledgeSourceText, ...]:
    return (
        KnowledgeSourceText(
            source_id="source-profile",
            content_type="text/plain",
            text="Customers can edit profiles.",
        ),
    )


def _compilation(statement: str) -> KnowledgeCompilation:
    return KnowledgeCompilation(
        project_id="slack-project-alpha",
        overview="A profile application.",
        facts=(
            KnowledgeFact(
                statement=statement,
                source_ids=("source-profile",),
            ),
        ),
        contradictions=(),
        gaps=(),
        confidence=KnowledgeConfidence.HIGH,
    )


@pytest.mark.asyncio
async def test_approved_grounded_knowledge_is_published() -> None:
    analyst = _KnowledgeAnalystDouble([_compilation("Customers edit profiles.")])
    reviewer = _KnowledgeReviewerDouble([KnowledgeReview(approved=True, feedback=())])
    repository = _KnowledgeRepositoryDouble()
    workflow = KnowledgeWorkflow(
        analyst=analyst,
        reviewer=reviewer,
        repository=repository,
    )

    result = await workflow.run(
        KnowledgeAnalysisTask(
            project_id="slack-project-alpha",
            sources=_sources(),
            expected_generation=0,
        )
    )

    assert result.artifact is not None
    assert result.artifact.generation == 1
    assert len(reviewer.tasks) == 1
    assert len(repository.calls) == 1


@pytest.mark.asyncio
async def test_reviewer_can_request_exactly_one_revision_before_publication() -> None:
    first = _compilation("Customers may edit profiles.")
    revised = _compilation("Customers can edit profiles.")
    analyst = _KnowledgeAnalystDouble([first, revised])
    reviewer = _KnowledgeReviewerDouble(
        [
            KnowledgeReview(
                approved=False,
                feedback=("Use the explicit source wording.",),
            ),
            KnowledgeReview(approved=True, feedback=()),
        ]
    )
    repository = _KnowledgeRepositoryDouble()
    workflow = KnowledgeWorkflow(
        analyst=analyst,
        reviewer=reviewer,
        repository=repository,
    )

    result = await workflow.run(
        KnowledgeAnalysisTask(
            project_id="slack-project-alpha",
            sources=_sources(),
            expected_generation=4,
        )
    )

    assert result.compilation == revised
    assert analyst.revisions == [(first, ("Use the explicit source wording.",))]
    assert len(reviewer.tasks) == 2
    assert repository.calls[0][1] == 4


@pytest.mark.asyncio
async def test_second_reviewer_rejection_stops_without_publication() -> None:
    analyst = _KnowledgeAnalystDouble(
        [
            _compilation("Customers may edit profiles."),
            _compilation("Customers perhaps edit profiles."),
        ]
    )
    reviewer = _KnowledgeReviewerDouble(
        [
            KnowledgeReview(approved=False, feedback=("Too uncertain.",)),
            KnowledgeReview(approved=False, feedback=("Still uncertain.",)),
        ]
    )
    repository = _KnowledgeRepositoryDouble()
    workflow = KnowledgeWorkflow(
        analyst=analyst,
        reviewer=reviewer,
        repository=repository,
    )

    with pytest.raises(KnowledgeReviewRejected):
        await workflow.run(
            KnowledgeAnalysisTask(
                project_id="slack-project-alpha",
                sources=_sources(),
                expected_generation=0,
            )
        )

    assert len(reviewer.tasks) == 2
    assert repository.calls == []


@pytest.mark.asyncio
async def test_approved_insufficient_knowledge_is_returned_without_publication() -> (
    None
):
    compilation = KnowledgeCompilation(
        project_id="slack-project-alpha",
        overview="The project behavior is not established.",
        facts=(),
        contradictions=(),
        gaps=(
            KnowledgeGap(
                description="No user-visible behavior was supplied.",
                blocking=True,
            ),
        ),
        confidence=KnowledgeConfidence.LOW,
    )
    analyst = _KnowledgeAnalystDouble([compilation])
    reviewer = _KnowledgeReviewerDouble([KnowledgeReview(approved=True, feedback=())])
    repository = _KnowledgeRepositoryDouble()
    workflow = KnowledgeWorkflow(
        analyst=analyst,
        reviewer=reviewer,
        repository=repository,
    )

    result = await workflow.run(
        KnowledgeAnalysisTask(
            project_id="slack-project-alpha",
            sources=_sources(),
            expected_generation=0,
        )
    )

    assert result.decision.readiness is KnowledgeReadiness.INSUFFICIENT
    assert result.artifact is None
    assert repository.calls == []
