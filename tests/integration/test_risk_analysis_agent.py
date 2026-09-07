from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.feature_planning import (
    REQUIRED_RISK_AREAS,
    RiskArea,
    RiskAreaAssessment,
    RiskAssessment,
    RiskDisposition,
    RiskItem,
    RiskPriority,
    RiskTask,
)
from app.product_alignment import (
    GroundedProductStatement,
    ProductAlignmentStatus,
    ProductIntent,
)
from app.risk_analysis_agent import (
    AdkRiskAnalyst,
    RiskAnalysisOutputError,
    create_risk_analysis_agent,
)


class _StructuredRiskModel(BaseLlm):
    response: RiskAssessment
    requests: list[LlmRequest]

    def __init__(self, response: RiskAssessment) -> None:
        super().__init__(
            model="test-risk-model",
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


def _assessment() -> RiskAssessment:
    areas = []
    for area in REQUIRED_RISK_AREAS:
        if area is RiskArea.STATE:
            areas.append(
                RiskAreaAssessment(
                    area=area,
                    disposition=RiskDisposition.IDENTIFIED,
                    rationale="Saving changes persistent profile state.",
                    risks=(
                        RiskItem(
                            risk_id="risk-state-stale-save",
                            area=area,
                            description="A stale save can overwrite a newer name.",
                            priority=RiskPriority.HIGH,
                        ),
                    ),
                )
            )
        else:
            areas.append(
                RiskAreaAssessment(
                    area=area,
                    disposition=RiskDisposition.NOT_APPLICABLE,
                    rationale="No distinct risk is supported for this area yet.",
                    risks=(),
                )
            )
    return RiskAssessment(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        areas=tuple(areas),
    )


@pytest.mark.asyncio
async def test_risk_analyst_assesses_intent_without_strategy_context() -> None:
    expected = _assessment()
    model = _StructuredRiskModel(expected)
    analyst = AdkRiskAnalyst(agent=create_risk_analysis_agent(model=model))
    task = RiskTask(product_intent=_intent())

    result = await analyst.assess(task)

    assert result == expected
    [request] = model.requests
    assert len(request.contents) == 1
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload == {"product_intent": _intent().model_dump(mode="json")}
    assert "strategy" not in payload


@pytest.mark.asyncio
async def test_risk_analyst_rejects_cross_project_output() -> None:
    cross_project = _assessment().model_copy(update={"project_id": "project-other"})
    analyst = AdkRiskAnalyst(
        agent=create_risk_analysis_agent(model=_StructuredRiskModel(cross_project))
    )

    with pytest.raises(RiskAnalysisOutputError):
        await analyst.assess(RiskTask(product_intent=_intent()))
