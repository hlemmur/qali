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
    REQUIRED_RISK_AREAS,
    CoverageDecision,
    CoverageDisposition,
    RiskAreaAssessment,
    RiskAssessment,
    RiskDisposition,
)
from app.feature_planning import (
    TestStrategy as Strategy,
)
from app.plan_reviewer_agent import AdkPlanReviewer, create_plan_reviewer_agent
from app.product_alignment import (
    GroundedProductStatement,
    ProductAlignmentStatus,
    ProductIntent,
)
from app.test_design import (
    EvidencePolicy,
    Oracle,
    OracleKind,
    OracleOperator,
)
from app.test_design import (
    TestDesignTask as DesignTask,
)
from app.test_design import (
    TestPlan as Plan,
)
from app.test_design import (
    TestScenario as Scenario,
)
from app.test_plan_workflow import PlanReview, PlanReviewTask


class _StructuredPlanReviewModel(BaseLlm):
    response: PlanReview
    requests: list[LlmRequest]

    def __init__(self, response: PlanReview) -> None:
        super().__init__(
            model="test-plan-review-model",
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


def _review_task() -> PlanReviewTask:
    statement = GroundedProductStatement(
        statement="The saved display name is shown.",
        source_ids=("source-profile",),
    )
    intent = ProductIntent(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        user_value=statement,
        expected_behaviors=(statement,),
        prerequisites=(),
        in_scope=(statement,),
        out_of_scope=(),
        ambiguities=(),
        status=ProductAlignmentStatus.READY,
    )
    strategy = Strategy(
        project_id=intent.project_id,
        feature_name=intent.feature_name,
        mission="Assess display-name editing.",
        coverage=tuple(
            CoverageDecision(
                concern=concern,
                disposition=CoverageDisposition.COVER,
                rationale="Explicitly covered.",
            )
            for concern in REQUIRED_COVERAGE_CONCERNS
        ),
        assumptions=(),
        stopping_conditions=("Stop after deterministic evidence.",),
    )
    risks = RiskAssessment(
        project_id=intent.project_id,
        feature_name=intent.feature_name,
        areas=tuple(
            RiskAreaAssessment(
                area=area,
                disposition=RiskDisposition.NOT_APPLICABLE,
                rationale="No supported risk.",
                risks=(),
            )
            for area in REQUIRED_RISK_AREAS
        ),
    )
    design_task = DesignTask(
        product_intent=intent,
        strategy=strategy,
        risk_assessment=risks,
    )
    plan = Plan(
        project_id=intent.project_id,
        feature_name=intent.feature_name,
        scenarios=(
            Scenario(
                scenario_id="scenario-profile-save",
                title="Save a valid display name",
                trace_refs=("product:expected_behavior:0",),
                coverage=REQUIRED_COVERAGE_CONCERNS,
                setup=(),
                user_intent="Change and save the display name.",
                step_budget=8,
                positive_oracles=(
                    Oracle(
                        oracle_id="oracle-name-visible",
                        kind=OracleKind.ACCESSIBILITY_TEXT,
                        subject="profile display name",
                        operator=OracleOperator.EQUALS,
                        expected="Updated Name",
                    ),
                ),
                forbidden_state_oracles=(
                    Oracle(
                        oracle_id="oracle-no-error",
                        kind=OracleKind.ACCESSIBILITY_TEXT,
                        subject="profile error alert",
                        operator=OracleOperator.ABSENT,
                        expected=None,
                    ),
                ),
                cleanup=(),
                evidence_policy=EvidencePolicy.FAILURE_ONLY,
            ),
        ),
    )
    return PlanReviewTask(design_task=design_task, plan=plan)


@pytest.mark.asyncio
async def test_plan_reviewer_independently_reviews_only_typed_plan_inputs() -> None:
    expected = PlanReview(approved=True, feedback=())
    model = _StructuredPlanReviewModel(expected)
    reviewer = AdkPlanReviewer(agent=create_plan_reviewer_agent(model=model))

    result = await reviewer.review(_review_task())

    assert result == expected
    [request] = model.requests
    assert len(request.contents) == 1
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload == _review_task().model_dump(mode="json")
