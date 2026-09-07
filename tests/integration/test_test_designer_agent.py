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
    CoverageConcern,
    CoverageDecision,
    CoverageDisposition,
    RiskAreaAssessment,
    RiskAssessment,
    RiskDisposition,
)
from app.feature_planning import (
    TestStrategy as Strategy,
)
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
from app.test_designer_agent import (
    AdkTestDesigner,
    create_test_designer_agent,
)
from app.test_designer_agent import (
    TestDesignerOutputError as DesignerOutputError,
)


class _StructuredDesignModel(BaseLlm):
    responses: list[Plan]
    requests: list[LlmRequest]

    def __init__(self, *responses: Plan) -> None:
        super().__init__(
            model="test-designer-model",
            responses=list(responses),
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
                parts=[
                    types.Part.from_text(text=self.responses.pop(0).model_dump_json())
                ],
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
    return Strategy(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        mission="Assess whether a customer can update a display name.",
        coverage=tuple(
            CoverageDecision(
                concern=concern,
                disposition=(
                    CoverageDisposition.NOT_APPLICABLE
                    if concern is CoverageConcern.MULTI_CONTEXT_CONCURRENCY
                    else CoverageDisposition.COVER
                ),
                rationale="This concern is explicitly accounted for.",
            )
            for concern in REQUIRED_COVERAGE_CONCERNS
        ),
        assumptions=("The customer begins authenticated.",),
        stopping_conditions=("Stop after deterministic evidence is collected.",),
    )


def _risks() -> RiskAssessment:
    return RiskAssessment(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        areas=tuple(
            RiskAreaAssessment(
                area=area,
                disposition=RiskDisposition.NOT_APPLICABLE,
                rationale="No distinct risk is supported for this area yet.",
                risks=(),
            )
            for area in REQUIRED_RISK_AREAS
        ),
    )


def _task() -> DesignTask:
    return DesignTask(
        product_intent=_intent(),
        strategy=_strategy(),
        risk_assessment=_risks(),
    )


def _plan() -> Plan:
    covered = tuple(
        decision.concern
        for decision in _strategy().coverage
        if decision.disposition is CoverageDisposition.COVER
    )
    return Plan(
        project_id="project-alpha",
        feature_name="Profile display-name editing",
        scenarios=(
            Scenario(
                scenario_id="scenario-profile-save",
                title="Save a valid display name",
                trace_refs=("product:expected_behavior:0",),
                coverage=covered,
                setup=("Start from the authenticated profile page.",),
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
                cleanup=("Restore the original display name.",),
                evidence_policy=EvidencePolicy.FAILURE_ONLY,
            ),
        ),
    )


@pytest.mark.asyncio
async def test_test_designer_synthesizes_typed_traceable_scenarios() -> None:
    expected = _plan()
    model = _StructuredDesignModel(expected)
    designer = AdkTestDesigner(agent=create_test_designer_agent(model=model))

    result = await designer.design(_task())

    assert result == expected
    [request] = model.requests
    assert len(request.contents) == 1
    payload = json.loads(request.contents[0].parts[0].text)
    assert payload["operation"] == "design"
    assert payload["task"] == _task().model_dump(mode="json")
    assert payload["prior"] is None
    assert payload["feedback"] == []


@pytest.mark.asyncio
async def test_test_designer_rejects_an_unsupported_trace_reference() -> None:
    plan = _plan()
    invalid_scenario = plan.scenarios[0].model_copy(
        update={"trace_refs": ("product:invented:0",)}
    )
    model = _StructuredDesignModel(
        plan.model_copy(update={"scenarios": (invalid_scenario,)})
    )
    designer = AdkTestDesigner(agent=create_test_designer_agent(model=model))

    with pytest.raises(DesignerOutputError):
        await designer.design(_task())


@pytest.mark.asyncio
async def test_test_designer_rejects_missing_required_strategy_coverage() -> None:
    plan = _plan()
    incomplete_scenario = plan.scenarios[0].model_copy(
        update={"coverage": (CoverageConcern.NOMINAL,)}
    )
    model = _StructuredDesignModel(
        plan.model_copy(update={"scenarios": (incomplete_scenario,)})
    )
    designer = AdkTestDesigner(agent=create_test_designer_agent(model=model))

    with pytest.raises(DesignerOutputError):
        await designer.design(_task())


@pytest.mark.asyncio
async def test_test_designer_rejects_a_cross_feature_plan() -> None:
    model = _StructuredDesignModel(
        _plan().model_copy(update={"feature_name": "Catalog filtering"})
    )
    designer = AdkTestDesigner(agent=create_test_designer_agent(model=model))

    with pytest.raises(DesignerOutputError):
        await designer.design(_task())


@pytest.mark.asyncio
async def test_test_designer_rejects_duplicate_scenario_ids() -> None:
    plan = _plan()
    model = _StructuredDesignModel(
        plan.model_copy(update={"scenarios": (plan.scenarios[0], plan.scenarios[0])})
    )
    designer = AdkTestDesigner(agent=create_test_designer_agent(model=model))

    with pytest.raises(DesignerOutputError):
        await designer.design(_task())


@pytest.mark.asyncio
async def test_test_designer_rejects_duplicate_oracle_ids() -> None:
    plan = _plan()
    scenario = plan.scenarios[0]
    duplicate_oracle = scenario.forbidden_state_oracles[0].model_copy(
        update={"oracle_id": scenario.positive_oracles[0].oracle_id}
    )
    model = _StructuredDesignModel(
        plan.model_copy(
            update={
                "scenarios": (
                    scenario.model_copy(
                        update={"forbidden_state_oracles": (duplicate_oracle,)}
                    ),
                )
            }
        )
    )
    designer = AdkTestDesigner(agent=create_test_designer_agent(model=model))

    with pytest.raises(DesignerOutputError):
        await designer.design(_task())


@pytest.mark.asyncio
async def test_test_designer_revision_uses_a_fresh_isolated_context() -> None:
    initial = _plan()
    revised = initial.model_copy(
        update={
            "scenarios": (
                initial.scenarios[0].model_copy(
                    update={"title": "Save and verify a valid display name"}
                ),
            )
        }
    )
    model = _StructuredDesignModel(initial, revised)
    designer = AdkTestDesigner(agent=create_test_designer_agent(model=model))

    assert await designer.design(_task()) == initial
    assert (
        await designer.revise(
            _task(),
            initial,
            ("Make the verification explicit.",),
        )
        == revised
    )

    assert len(model.requests) == 2
    assert all(len(request.contents) == 1 for request in model.requests)
    revision_payload = json.loads(model.requests[1].contents[0].parts[0].text)
    assert revision_payload["operation"] == "revise"
    assert revision_payload["task"] == _task().model_dump(mode="json")
    assert revision_payload["prior"] == initial.model_dump(mode="json")
    assert revision_payload["feedback"] == ["Make the verification explicit."]
