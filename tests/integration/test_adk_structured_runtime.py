from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest
from google.adk.agents import Agent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.adk_structured_runtime import (
    StructuredAgentRequestBudgetError,
    StructuredAgentTimeoutError,
    run_isolated_structured_agent,
)
from app.slack_coordinator import (
    CoordinatorDecision,
    CoordinatorRequest,
    create_slack_coordinator_agent,
)


class _HangingModel(BaseLlm):
    def __init__(self) -> None:
        super().__init__(model="test-hanging-model")

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        del llm_request, stream
        await asyncio.Event().wait()
        yield LlmResponse()


class _LoopingToolModel(BaseLlm):
    calls: int

    def __init__(self) -> None:
        super().__init__(model="test-looping-tool-model", calls=0)

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        del llm_request, stream
        self.calls += 1
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part.from_function_call(name="keep_going", args={})],
            )
        )


@pytest.mark.asyncio
async def test_isolated_agent_times_out_with_a_stable_redacted_error() -> None:
    request = CoordinatorRequest(
        project_id="project-alpha",
        request_text="test the profile feature with secret-marker",
        project_ready=True,
    )

    with pytest.raises(
        StructuredAgentTimeoutError,
        match="structured agent invocation timed out",
    ) as captured:
        await run_isolated_structured_agent(
            agent=create_slack_coordinator_agent(model=_HangingModel()),
            app_name="timeout-test",
            user_id="project-alpha",
            request=request,
            result_type=CoordinatorDecision,
            timeout_seconds=0.01,
        )

    assert "secret-marker" not in str(captured.value)
    assert captured.value.__cause__ is None


@pytest.mark.asyncio
async def test_tool_free_runtime_stops_at_one_model_request_by_default() -> None:
    def keep_going() -> dict[str, bool]:
        """Continue the deterministic model loop."""
        return {"continued": True}

    model = _LoopingToolModel()
    agent = Agent(
        name="request_budget_test",
        model=model,
        tools=[keep_going],
    )
    request = CoordinatorRequest(
        project_id="project-alpha",
        request_text="test one feature",
        project_ready=True,
    )

    with pytest.raises(
        StructuredAgentRequestBudgetError,
        match="structured agent model request budget exceeded",
    ) as captured:
        await run_isolated_structured_agent(
            agent=agent,
            app_name="request-budget-test",
            user_id="project-alpha",
            request=request,
            result_type=CoordinatorDecision,
        )

    assert model.calls == 1
    assert captured.value.__cause__ is None
