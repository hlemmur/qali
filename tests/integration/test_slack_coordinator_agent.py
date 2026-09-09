from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.slack_coordinator import (
    AdkSlackCoordinator,
    CoordinatorDecision,
    CoordinatorOutputError,
    CoordinatorRequest,
    CoordinatorStatus,
    CoordinatorWorkflow,
    create_slack_coordinator_agent,
)


class _StructuredCoordinatorModel(BaseLlm):
    response: CoordinatorDecision
    requests: list[LlmRequest]

    def __init__(self, response: CoordinatorDecision) -> None:
        super().__init__(
            model="test-coordinator-model",
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


def _request() -> CoordinatorRequest:
    return CoordinatorRequest(
        project_id="project-alpha",
        request_text="Please check whether profile names can be updated.",
        project_ready=True,
        known_finding_ids=(),
    )


@pytest.mark.asyncio
async def test_coordinator_routes_natural_language_with_no_tools_or_history() -> None:
    expected = CoordinatorDecision(
        status=CoordinatorStatus.READY,
        workflow=CoordinatorWorkflow.TEST_FEATURE,
    )
    model = _StructuredCoordinatorModel(expected)
    agent = create_slack_coordinator_agent(model=model)
    coordinator = AdkSlackCoordinator(agent=agent)

    result = await coordinator.route(_request())

    assert result == expected
    assert agent.tools == []
    assert agent.include_contents == "none"
    assert agent.disallow_transfer_to_parent is True
    assert agent.disallow_transfer_to_peers is True
    [llm_request] = model.requests
    assert len(llm_request.contents) == 1
    assert json.loads(llm_request.contents[0].parts[0].text) == _request().model_dump(
        mode="json"
    )


@pytest.mark.asyncio
async def test_coordinator_fails_closed_on_an_ungrounded_finding() -> None:
    model = _StructuredCoordinatorModel(
        CoordinatorDecision(
            status=CoordinatorStatus.READY,
            workflow=CoordinatorWorkflow.EXPLAIN_FINDING,
            finding_id="finding-fedcba9876543210",
        )
    )
    coordinator = AdkSlackCoordinator(agent=create_slack_coordinator_agent(model=model))

    with pytest.raises(CoordinatorOutputError):
        await coordinator.route(_request())
