from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.failure_investigation import (
    ClassificationConfidence,
    FailureAnalysis,
    FailureClassification,
    FailureReview,
    FailureReviewTask,
    build_failure_analysis_task,
)
from app.failure_investigator_agents import (
    AdkFailureInvestigator,
    AdkFailureReviewer,
    FailureInvestigatorOutputError,
    create_failure_investigator_agent,
    create_failure_reviewer_agent,
)
from tests.integration.test_failure_investigation_workflow import _attempt, _task


class _StructuredModel(BaseLlm):
    response: FailureAnalysis | FailureReview
    requests: list[LlmRequest]

    def __init__(self, response: FailureAnalysis | FailureReview) -> None:
        super().__init__(model="test-failure-model", response=response, requests=[])

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


def _analysis_task():
    return build_failure_analysis_task(
        _task(),
        _attempt(passed=False, run="reproduction"),
    )


def _analysis() -> FailureAnalysis:
    return FailureAnalysis(
        classification=FailureClassification.PRODUCT_DEFECT,
        confidence=ClassificationConfidence.HIGH,
        summary="Saved profile name remains unchanged.",
        rationale="The same oracle failed in both isolated attempts.",
        failed_oracle_ids=("oracle-name-visible",),
    )


@pytest.mark.asyncio
async def test_failure_investigator_receives_only_typed_failure_evidence() -> None:
    expected = _analysis()
    model = _StructuredModel(expected)
    investigator = AdkFailureInvestigator(
        agent=create_failure_investigator_agent(model=model)
    )

    result = await investigator.classify(_analysis_task())

    assert result == expected
    [request] = model.requests
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload["operation"] == "classify"
    assert payload["task"] == _analysis_task().model_dump(mode="json")
    assert "target_policy" not in json.dumps(payload)
    assert "secret_ref" not in json.dumps(payload)


@pytest.mark.asyncio
async def test_failure_reviewer_is_an_independent_tool_free_gate() -> None:
    expected = FailureReview(approved=True, feedback=())
    model = _StructuredModel(expected)
    agent = create_failure_reviewer_agent(model=model)
    reviewer = AdkFailureReviewer(agent=agent)
    task = FailureReviewTask(analysis_task=_analysis_task(), analysis=_analysis())

    result = await reviewer.review(task)

    assert result == expected
    assert agent.tools == []
    [request] = model.requests
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload == task.model_dump(mode="json")


@pytest.mark.asyncio
async def test_failure_investigator_fails_closed_on_unreproduced_product_claim() -> (
    None
):
    model = _StructuredModel(_analysis())
    investigator = AdkFailureInvestigator(
        agent=create_failure_investigator_agent(model=model)
    )
    task = build_failure_analysis_task(
        _task(),
        _attempt(
            passed=False,
            run="reproduction",
            actual="A different observed failure",
        ),
    )

    with pytest.raises(FailureInvestigatorOutputError):
        await investigator.classify(task)
