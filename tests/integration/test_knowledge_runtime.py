from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import BaseModel

from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
    KnowledgeReadiness,
)
from app.knowledge_repository import KnowledgeArtifact
from app.knowledge_runtime import create_adk_knowledge_workflow
from app.knowledge_workflow import (
    KnowledgeAnalysisTask,
    KnowledgeReview,
)
from app.source_text_extraction import KnowledgeSourceText


class _StructuredModel(BaseLlm):
    response: BaseModel
    requests: list[LlmRequest]

    def __init__(self, response: BaseModel) -> None:
        super().__init__(
            model="test-structured-model",
            response=response,
            requests=[],
        )

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        assert stream is False
        self.requests.append(llm_request)
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text=self.response.model_dump_json())],
            )
        )


class _KnowledgeRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[bytes, int]] = []

    async def publish(self, document, *, expected_generation: int):
        self.calls.append((document.content, expected_generation))
        return KnowledgeArtifact(
            project_id=document.project_id,
            object_name=f"projects/{document.project_id}/knowledge/index.md",
            sha256=document.sha256,
            generation=expected_generation + 1,
            updated_at=datetime(2026, 9, 4, 14, 30, tzinfo=UTC),
        )


@pytest.mark.asyncio
async def test_adk_knowledge_runtime_compiles_reviews_and_publishes() -> None:
    analyst_model = _StructuredModel(
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
    )
    reviewer_model = _StructuredModel(KnowledgeReview(approved=True, feedback=()))
    repository = _KnowledgeRepository()
    workflow = create_adk_knowledge_workflow(
        repository=repository,
        analyst_model=analyst_model,
        reviewer_model=reviewer_model,
    )

    result = await workflow.run(
        KnowledgeAnalysisTask(
            project_id="project-alpha",
            sources=(
                KnowledgeSourceText(
                    source_id="source-profile",
                    content_type="text/plain",
                    text="Customers can edit profiles.",
                ),
            ),
            expected_generation=0,
        )
    )

    assert result.decision.readiness is KnowledgeReadiness.READY
    assert result.artifact is not None
    assert result.artifact.generation == 1
    assert len(analyst_model.requests) == 1
    assert len(reviewer_model.requests) == 1
    assert len(repository.calls) == 1
