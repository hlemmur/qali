from __future__ import annotations

from typing import TypeVar
from uuid import uuid4

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

StructuredResult = TypeVar("StructuredResult", bound=BaseModel)


async def run_isolated_structured_agent(
    *,
    agent: Agent,
    app_name: str,
    user_id: str,
    request: BaseModel,
    result_type: type[StructuredResult],
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
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text=request.model_dump_json())],
        ),
    ):
        if event.is_final_response() and event.content is not None:
            output_text = "".join(part.text or "" for part in event.content.parts or [])
    if output_text is None:
        raise ValueError("structured agent returned no final output")
    return result_type.model_validate_json(output_text)


__all__ = ["run_isolated_structured_agent"]
