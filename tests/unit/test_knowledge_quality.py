from __future__ import annotations

import pytest

from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
    KnowledgeGap,
    KnowledgeGroundingError,
    KnowledgeQualityPolicy,
    KnowledgeReadiness,
)


def test_grounded_knowledge_with_sufficient_confidence_is_ready() -> None:
    compilation = KnowledgeCompilation(
        project_id="slack-project-alpha",
        overview="A customer profile application.",
        facts=(
            KnowledgeFact(
                statement="Customers can edit their profile.",
                source_ids=("source-profile",),
            ),
        ),
        contradictions=(),
        gaps=(),
        confidence=KnowledgeConfidence.HIGH,
    )

    decision = KnowledgeQualityPolicy().evaluate(
        compilation,
        available_source_ids={"source-profile"},
    )

    assert decision.readiness is KnowledgeReadiness.READY
    assert decision.reasons == ()


def test_blocking_gaps_and_low_confidence_are_explicitly_insufficient() -> None:
    compilation = KnowledgeCompilation(
        project_id="slack-project-alpha",
        overview="The application purpose is not established.",
        facts=(),
        contradictions=(),
        gaps=(
            KnowledgeGap(
                description="No reachable product behavior was supplied.",
                blocking=True,
            ),
        ),
        confidence=KnowledgeConfidence.LOW,
    )

    decision = KnowledgeQualityPolicy().evaluate(
        compilation,
        available_source_ids={"source-empty"},
    )

    assert decision.readiness is KnowledgeReadiness.INSUFFICIENT
    assert decision.reasons == (
        "no_grounded_facts",
        "low_confidence",
        "blocking_gaps",
    )


def test_unknown_citation_fails_closed_as_ungrounded_output() -> None:
    compilation = KnowledgeCompilation(
        project_id="slack-project-alpha",
        overview="A customer profile application.",
        facts=(
            KnowledgeFact(
                statement="Administrators can export customer secrets.",
                source_ids=("invented-source",),
            ),
        ),
        contradictions=(),
        gaps=(),
        confidence=KnowledgeConfidence.HIGH,
    )

    with pytest.raises(KnowledgeGroundingError) as caught:
        KnowledgeQualityPolicy().evaluate(
            compilation,
            available_source_ids={"source-profile"},
        )

    assert str(caught.value) == "knowledge output contains invalid citations"
