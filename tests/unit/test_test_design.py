from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.feature_planning import CoverageConcern
from app.test_design import (
    EvidencePolicy,
    Oracle,
    OracleKind,
    OracleOperator,
)
from app.test_design import (
    TestScenario as Scenario,
)


def test_absence_oracle_cannot_declare_an_expected_value() -> None:
    with pytest.raises(ValidationError, match="absence oracle"):
        Oracle(
            oracle_id="oracle-no-error",
            kind=OracleKind.ACCESSIBILITY_TEXT,
            subject="error alert",
            operator=OracleOperator.ABSENT,
            expected="No error",
        )


def test_value_oracle_requires_an_expected_value() -> None:
    with pytest.raises(ValidationError, match="value oracle"):
        Oracle(
            oracle_id="oracle-name-visible",
            kind=OracleKind.ACCESSIBILITY_TEXT,
            subject="profile display name",
            operator=OracleOperator.EQUALS,
            expected=None,
        )


def test_scenario_rejects_unknown_strategy_coverage() -> None:
    with pytest.raises(ValidationError, match="coverage"):
        Scenario(
            scenario_id="scenario-profile-save",
            title="Save a valid display name",
            trace_refs=("product:expected_behavior:0",),
            coverage=("invented-concern",),
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
        )


def test_scenario_preserves_typed_strategy_coverage() -> None:
    scenario = Scenario(
        scenario_id="scenario-profile-save",
        title="Save a valid display name",
        trace_refs=("product:expected_behavior:0",),
        coverage=(CoverageConcern.NOMINAL,),
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
    )

    assert scenario.coverage == (CoverageConcern.NOMINAL,)
