from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.feature_planning import (
    REQUIRED_COVERAGE_CONCERNS,
    REQUIRED_RISK_AREAS,
    CoverageConcern,
    CoverageDecision,
    CoverageDisposition,
    RiskArea,
    RiskAreaAssessment,
    RiskAssessment,
    RiskDisposition,
    RiskItem,
    RiskPriority,
    RiskTask,
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


def _ambiguous_intent() -> ProductIntent:
    statement = GroundedProductStatement(
        statement="Customers can edit profiles.",
        source_ids=("source-profile",),
    )
    return ProductIntent(
        project_id="project-alpha",
        feature_name="Profile changes",
        user_value=statement,
        expected_behaviors=(),
        prerequisites=(),
        in_scope=(statement,),
        out_of_scope=(),
        ambiguities=("The request names both profile and credential changes.",),
        status=ProductAlignmentStatus.NEEDS_CLARIFICATION,
    )


def test_strategy_and_risk_require_ready_product_intent() -> None:
    with pytest.raises(ValidationError, match="strategy requires"):
        StrategyTask(product_intent=_ambiguous_intent())
    with pytest.raises(ValidationError, match="risk analysis requires"):
        RiskTask(product_intent=_ambiguous_intent())


def test_strategy_requires_one_decision_for_every_coverage_concern() -> None:
    incomplete = tuple(
        CoverageDecision(
            concern=concern,
            disposition=CoverageDisposition.COVER,
            rationale="Exercise this concern within the approved feature boundary.",
        )
        for concern in REQUIRED_COVERAGE_CONCERNS
        if concern is not CoverageConcern.ENVIRONMENT
    )

    with pytest.raises(ValidationError, match="every coverage concern exactly once"):
        Strategy(
            project_id="project-alpha",
            feature_name="Profile editing",
            mission="Assess profile editing.",
            coverage=incomplete,
            assumptions=(),
            stopping_conditions=("Stop after deterministic evidence is collected.",),
        )


def test_risk_assessment_requires_one_decision_for_every_risk_area() -> None:
    incomplete = tuple(
        RiskAreaAssessment(
            area=area,
            disposition=RiskDisposition.NOT_APPLICABLE,
            rationale="No distinct risk is supported for this area yet.",
            risks=(),
        )
        for area in REQUIRED_RISK_AREAS
        if area is not RiskArea.CONCURRENCY
    )

    with pytest.raises(ValidationError, match="every risk area exactly once"):
        RiskAssessment(
            project_id="project-alpha",
            feature_name="Profile editing",
            areas=incomplete,
        )


def test_identified_risk_area_requires_a_concrete_risk() -> None:
    with pytest.raises(ValidationError, match="identified risk area"):
        RiskAreaAssessment(
            area=RiskArea.STATE,
            disposition=RiskDisposition.IDENTIFIED,
            rationale="Saving changes persistent state.",
            risks=(),
        )


def test_not_applicable_risk_area_cannot_hide_a_concrete_risk() -> None:
    with pytest.raises(ValidationError, match="not-applicable risk area"):
        RiskAreaAssessment(
            area=RiskArea.STATE,
            disposition=RiskDisposition.NOT_APPLICABLE,
            rationale="No state risk is expected.",
            risks=(
                RiskItem(
                    risk_id="risk-state-stale-save",
                    area=RiskArea.STATE,
                    description="A stale save can overwrite a newer value.",
                    priority=RiskPriority.HIGH,
                ),
            ),
        )


def test_risk_item_must_match_its_assessed_area() -> None:
    with pytest.raises(ValidationError, match="match the assessed area"):
        RiskAreaAssessment(
            area=RiskArea.STATE,
            disposition=RiskDisposition.IDENTIFIED,
            rationale="Saving changes persistent state.",
            risks=(
                RiskItem(
                    risk_id="risk-data-loss",
                    area=RiskArea.DATA,
                    description="A save can lose data.",
                    priority=RiskPriority.HIGH,
                ),
            ),
        )


def test_risk_assessment_requires_distinct_stable_risk_ids() -> None:
    areas = []
    for area in REQUIRED_RISK_AREAS:
        if area in {RiskArea.STATE, RiskArea.DATA}:
            areas.append(
                RiskAreaAssessment(
                    area=area,
                    disposition=RiskDisposition.IDENTIFIED,
                    rationale="A concrete risk applies.",
                    risks=(
                        RiskItem(
                            risk_id="risk-duplicate",
                            area=area,
                            description="A concrete risk description.",
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

    with pytest.raises(ValidationError, match="risk IDs must be distinct"):
        RiskAssessment(
            project_id="project-alpha",
            feature_name="Profile editing",
            areas=tuple(areas),
        )
