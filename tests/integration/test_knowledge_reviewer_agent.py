from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
    KnowledgeQualityDecision,
    KnowledgeReadiness,
)
from app.knowledge_reviewer_agent import (
    AdkKnowledgeReviewer,
    create_knowledge_reviewer_agent,
)
from app.knowledge_workflow import KnowledgeReview, KnowledgeReviewTask
from app.source_text_extraction import KnowledgeSourceText


class _StructuredReviewModel(BaseLlm):
    response: KnowledgeReview
    requests: list[LlmRequest]

    def __init__(self, response: KnowledgeReview) -> None:
        super().__init__(
            model="test-review-model",
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


def _review_task() -> KnowledgeReviewTask:
    return KnowledgeReviewTask(
        compilation=KnowledgeCompilation(
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
        ),
        decision=KnowledgeQualityDecision(
            readiness=KnowledgeReadiness.READY,
            reasons=(),
        ),
        sources=(
            KnowledgeSourceText(
                source_id="source-profile",
                content_type="text/plain",
                text="Customers can edit profiles.",
            ),
        ),
    )


@pytest.mark.asyncio
async def test_adk_knowledge_reviewer_independently_reviews_typed_evidence() -> None:
    expected = KnowledgeReview(approved=True, feedback=())
    model = _StructuredReviewModel(expected)
    reviewer = AdkKnowledgeReviewer(
        agent=create_knowledge_reviewer_agent(model=model),
    )

    result = await reviewer.review(_review_task())

    assert result == expected
    [request] = model.requests
    assert len(request.contents) == 1
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload["compilation"]["project_id"] == "project-alpha"
    assert payload["decision"]["readiness"] == "ready"
    assert payload["sources"][0]["source_id"] == "source-profile"
