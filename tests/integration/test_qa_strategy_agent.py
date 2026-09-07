from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.feature_planning import (
    REQUIRED_COVERAGE_CONCERNS,
    CoverageConcern,
    CoverageDecision,
    CoverageDisposition,
    StrategyTask,
)
from app.feature_planning import (
    TestStrategy as Strategy,
)
from app.product_alignment import (
    GroundedProductStatement,
    ProductAlignmentStatus,
    ProductIntent,
)
from app.qa_strategy_agent import (
    AdkQaStrategist,
    QaStrategyOutputError,
    create_qa_strategy_agent,
)


class _StructuredStrategyModel(BaseLlm):
    response: Strategy
    requests: list[LlmRequest]

    def __init__(self, response: Strategy) -> None:
        super().__init__(
            model="test-strategy-model",
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


def _statement(statement: str) -> GroundedProductStatement:
    return GroundedProductStatement(
        statement=statement,
        source_ids=("source-profile",),
    )


def _intent() -> ProductIntent:
    return ProductIntent(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        user_value=_statement("Customers can keep their visible identity current."),
        expected_behaviors=(_statement("The saved display name is shown."),),
        prerequisites=(),
        in_scope=(_statement("Editing and saving the display name."),),
        out_of_scope=("Changing account credentials",),
        ambiguities=(),
        status=ProductAlignmentStatus.READY,
    )


def _strategy() -> Strategy:
    coverage = tuple(
        CoverageDecision(
            concern=concern,
            disposition=(
                CoverageDisposition.NOT_APPLICABLE
                if concern is CoverageConcern.MULTI_CONTEXT_CONCURRENCY
                else CoverageDisposition.COVER
            ),
            rationale=(
                "The compiled intent defines no meaningful cross-context behavior."
                if concern is CoverageConcern.MULTI_CONTEXT_CONCURRENCY
                else "Exercise this concern within the approved feature boundary."
            ),
        )
        for concern in REQUIRED_COVERAGE_CONCERNS
    )
    return Strategy(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        mission="Assess whether a customer can safely update a display name.",
        coverage=coverage,
        assumptions=("The customer begins authenticated.",),
        stopping_conditions=(
            "Stop when every covered concern has deterministic scenario evidence.",
        ),
    )


@pytest.mark.asyncio
async def test_qa_strategist_receives_only_approved_product_intent() -> None:
    expected = _strategy()
    model = _StructuredStrategyModel(expected)
    strategist = AdkQaStrategist(agent=create_qa_strategy_agent(model=model))
    task = StrategyTask(product_intent=_intent())

    result = await strategist.plan(task)

    assert result == expected
    [request] = model.requests
    assert len(request.contents) == 1
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload == {"product_intent": _intent().model_dump(mode="json")}


@pytest.mark.asyncio
async def test_qa_strategist_rejects_cross_feature_output() -> None:
    cross_feature = _strategy().model_copy(
        update={"feature_name": "Account credential changes"}
    )
    strategist = AdkQaStrategist(
        agent=create_qa_strategy_agent(model=_StructuredStrategyModel(cross_feature))
    )

    with pytest.raises(QaStrategyOutputError):
        await strategist.plan(StrategyTask(product_intent=_intent()))
