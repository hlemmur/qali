from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.knowledge_analyst_agent import (
    AdkKnowledgeAnalyst,
    create_knowledge_analyst_agent,
)
from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeConfidence,
    KnowledgeFact,
)
from app.knowledge_workflow import KnowledgeAnalysisTask
from app.source_text_extraction import KnowledgeSourceText


class _StructuredModel(BaseLlm):
    responses: list[KnowledgeCompilation]
    requests: list[LlmRequest]

    def __init__(self, *responses: KnowledgeCompilation) -> None:
        super().__init__(
            model="test-structured-model",
            responses=list(responses),
            requests=[],
        )

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        assert stream is False
        self.requests.append(llm_request)
        response = self.responses.pop(0)
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text=response.model_dump_json())],
            )
        )


def _task() -> KnowledgeAnalysisTask:
    return KnowledgeAnalysisTask(
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


def _compilation(statement: str) -> KnowledgeCompilation:
    return KnowledgeCompilation(
        project_id="project-alpha",
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
async def test_adk_knowledge_analyst_compiles_in_a_fresh_typed_context() -> None:
    expected = _compilation("Customers can edit profiles.")
    model = _StructuredModel(expected)
    analyst = AdkKnowledgeAnalyst(
        agent=create_knowledge_analyst_agent(model=model),
    )

    result = await analyst.compile(_task())

    assert result == expected
    [request] = model.requests
    assert len(request.contents) == 1
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload["operation"] == "compile"
    assert payload["task"]["project_id"] == "project-alpha"
    assert payload["task"]["sources"][0]["source_id"] == "source-profile"
    assert payload["prior"] is None
    assert payload["feedback"] == []


@pytest.mark.asyncio
async def test_adk_knowledge_analyst_revision_has_no_prior_session_history() -> None:
    first = _compilation("Customers may edit profiles.")
    revised = _compilation("Customers can edit profiles.")
    model = _StructuredModel(first, revised)
    analyst = AdkKnowledgeAnalyst(
        agent=create_knowledge_analyst_agent(model=model),
    )

    assert await analyst.compile(_task()) == first
    result = await analyst.revise(
        _task(),
        first,
        ("Use the explicit source wording.",),
    )

    assert result == revised
    assert len(model.requests) == 2
    revision_request = model.requests[1]
    assert len(revision_request.contents) == 1
    payload = json.loads(revision_request.contents[0].parts[0].text)
    assert payload["operation"] == "revise"
    assert payload["prior"]["facts"][0]["statement"] == ("Customers may edit profiles.")
    assert payload["feedback"] == ["Use the explicit source wording."]
