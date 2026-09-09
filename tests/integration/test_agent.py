# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

from collections.abc import AsyncGenerator

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agent import root_agent
from app.slack_coordinator import (
    CoordinatorDecision,
    CoordinatorRequest,
    CoordinatorStatus,
    CoordinatorWorkflow,
    create_slack_coordinator_agent,
)


class _CoordinatorModel(BaseLlm):
    def __init__(self) -> None:
        super().__init__(model="test-root-coordinator-model")

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        assert stream is False
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[
                    types.Part.from_text(
                        text=CoordinatorDecision(
                            status=CoordinatorStatus.READY,
                            workflow=CoordinatorWorkflow.TEST_FEATURE,
                        ).model_dump_json()
                    )
                ],
            )
        )


def test_agent_streams_a_typed_coordinator_decision() -> None:
    assert root_agent.input_schema is CoordinatorRequest
    assert root_agent.output_schema is CoordinatorDecision

    session_service = InMemorySessionService()
    agent = create_slack_coordinator_agent(model=_CoordinatorModel())
    session = session_service.create_session_sync(user_id="test_user", app_name="test")
    runner = Runner(agent=agent, session_service=session_service, app_name="test")
    request = CoordinatorRequest(
        project_id="project-alpha",
        request_text="Please test profile editing.",
        project_ready=True,
    )
    message = types.Content(
        role="user",
        parts=[types.Part.from_text(text=request.model_dump_json())],
    )

    events = list(
        runner.run(
            new_message=message,
            user_id="test_user",
            session_id=session.id,
        )
    )

    final_text = "".join(
        part.text or ""
        for event in events
        if event.is_final_response() and event.content is not None
        for part in event.content.parts or []
    )
    assert CoordinatorDecision.model_validate_json(final_text) == CoordinatorDecision(
        status=CoordinatorStatus.READY,
        workflow=CoordinatorWorkflow.TEST_FEATURE,
    )
