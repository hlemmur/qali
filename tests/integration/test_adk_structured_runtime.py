from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest
from google.adk.agents import Agent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import PrivateAttr

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


class _ConcurrencyProbe:
    def __init__(self) -> None:
        self.active = 0
        self.peak = 0
        self.two_entered = asyncio.Event()
        self.release = asyncio.Event()

    async def wait(self) -> None:
        self.active += 1
        self.peak = max(self.peak, self.active)
        if self.active == 2:
            self.two_entered.set()
        try:
            await self.release.wait()
        finally:
            self.active -= 1


class _BlockingModel(BaseLlm):
    _probe: _ConcurrencyProbe = PrivateAttr()

    def __init__(self, probe: _ConcurrencyProbe) -> None:
        super().__init__(model="test-blocking-model")
        self._probe = probe

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        del llm_request, stream
        await self._probe.wait()
        decision = CoordinatorDecision(status="ready", workflow="test_feature")
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text=decision.model_dump_json())],
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


@pytest.mark.asyncio
async def test_isolated_agents_allow_at_most_two_concurrent_model_invocations() -> None:
    probe = _ConcurrencyProbe()
    request = CoordinatorRequest(
        project_id="project-alpha",
        request_text="test one feature",
        project_ready=True,
    )

    pending = [
        asyncio.create_task(
            run_isolated_structured_agent(
                agent=create_slack_coordinator_agent(model=_BlockingModel(probe)),
                app_name=f"concurrency-test-{index}",
                user_id="project-alpha",
                request=request,
                result_type=CoordinatorDecision,
            )
        )
        for index in range(3)
    ]
    try:
        await asyncio.wait_for(probe.two_entered.wait(), timeout=10)
        await asyncio.sleep(0)
        assert probe.peak == 2
    finally:
        probe.release.set()
    results = await asyncio.gather(*pending)
    assert len(results) == 3
