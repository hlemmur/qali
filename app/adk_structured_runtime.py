from __future__ import annotations

import asyncio
from typing import TypeVar
from uuid import uuid4

from google.adk.agents import Agent
from google.adk.agents.invocation_context import LlmCallsLimitExceededError
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

StructuredResult = TypeVar("StructuredResult", bound=BaseModel)
DEFAULT_AGENT_TIMEOUT_SECONDS = 300.0
DEFAULT_MAX_LLM_CALLS = 1
MAX_CONCURRENT_AGENT_INVOCATIONS = 2
_AGENT_INVOCATION_GATE = asyncio.Semaphore(MAX_CONCURRENT_AGENT_INVOCATIONS)


class StructuredAgentRequestBudgetError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("structured agent model request budget exceeded")


class StructuredAgentTimeoutError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("structured agent invocation timed out")


async def run_isolated_structured_agent(
    *,
    agent: Agent,
    app_name: str,
    user_id: str,
    request: BaseModel,
    result_type: type[StructuredResult],
    timeout_seconds: float = DEFAULT_AGENT_TIMEOUT_SECONDS,
    max_llm_calls: int = DEFAULT_MAX_LLM_CALLS,
) -> StructuredResult:
    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name=app_name,
        user_id=user_id,
        session_id=str(uuid4()),
    )
    runner = Runner(
        agent=agent,
        app_name=app_name,
        session_service=session_service,
    )
    output_text: str | None = None
    try:
        async with asyncio.timeout(timeout_seconds):
            async with _AGENT_INVOCATION_GATE:
                async for event in runner.run_async(
                    user_id=user_id,
                    session_id=session.id,
                    new_message=types.Content(
                        role="user",
                        parts=[types.Part.from_text(text=request.model_dump_json())],
                    ),
                    run_config=RunConfig(max_llm_calls=max_llm_calls),
                ):
                    if event.is_final_response() and event.content is not None:
                        output_text = "".join(
                            part.text or "" for part in event.content.parts or []
                        )
    except TimeoutError:
        raise StructuredAgentTimeoutError from None
    except LlmCallsLimitExceededError:
        raise StructuredAgentRequestBudgetError from None
    if output_text is None:
        raise ValueError("structured agent returned no final output")
    return result_type.model_validate_json(output_text)


__all__ = [
    "DEFAULT_AGENT_TIMEOUT_SECONDS",
    "DEFAULT_MAX_LLM_CALLS",
    "MAX_CONCURRENT_AGENT_INVOCATIONS",
    "StructuredAgentRequestBudgetError",
    "StructuredAgentTimeoutError",
    "run_isolated_structured_agent",
]
