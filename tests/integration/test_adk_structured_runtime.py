from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse

from app.adk_structured_runtime import (
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
