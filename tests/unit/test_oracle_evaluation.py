from __future__ import annotations

import pytest

from app.oracle_evaluation import (
    OracleActual,
    OracleCheckStatus,
    OracleEvaluationError,
    evaluate_oracles,
)
from app.test_design import Oracle, OracleKind, OracleOperator


def _oracles() -> tuple[Oracle, ...]:
    return (
        Oracle(
            oracle_id="oracle-profile-url",
            kind=OracleKind.URL,
            subject="current URL",
            operator=OracleOperator.CONTAINS,
            expected="/profile",
        ),
        Oracle(
            oracle_id="oracle-name-visible",
            kind=OracleKind.ACCESSIBILITY_TEXT,
            subject="profile display name",
            operator=OracleOperator.EQUALS,
            expected="Updated Name",
        ),
        Oracle(
            oracle_id="oracle-no-alert",
            kind=OracleKind.ACCESSIBILITY_TEXT,
            subject="error alert",
            operator=OracleOperator.ABSENT,
            expected=None,
        ),
    )


def test_harness_evaluates_every_oracle_without_a_model_verdict() -> None:
    result = evaluate_oracles(
        _oracles(),
        actuals=(
            OracleActual(
                oracle_id="oracle-profile-url",
                kind=OracleKind.URL,
                subject="current URL",
                actual="https://example.test/profile",
            ),
            OracleActual(
                oracle_id="oracle-name-visible",
                kind=OracleKind.ACCESSIBILITY_TEXT,
                subject="profile display name",
                actual="Updated Name",
            ),
            OracleActual(
                oracle_id="oracle-no-alert",
                kind=OracleKind.ACCESSIBILITY_TEXT,
                subject="error alert",
                actual=None,
            ),
        ),
    )

    assert result.passed is True
    assert result.check_count == 3
    assert {check.status for check in result.checks} == {OracleCheckStatus.PASSED}


def test_failed_oracle_produces_a_deterministic_failed_check() -> None:
    oracle = Oracle(
        oracle_id="oracle-item-count",
        kind=OracleKind.ELEMENT_COUNT,
        subject="saved items",
        operator=OracleOperator.AT_LEAST,
        expected=2,
    )

    result = evaluate_oracles(
        (oracle,),
        actuals=(
            OracleActual(
                oracle_id=oracle.oracle_id,
                kind=oracle.kind,
                subject=oracle.subject,
                actual=1,
            ),
        ),
    )

    assert result.passed is False
    assert result.checks[0].status is OracleCheckStatus.FAILED
    assert result.checks[0].expected == 2
    assert result.checks[0].actual == 1


def test_missing_or_mismatched_actuals_fail_closed() -> None:
    with pytest.raises(OracleEvaluationError, match="exactly one"):
        evaluate_oracles(_oracles(), actuals=())

    oracle = _oracles()[0]
    with pytest.raises(OracleEvaluationError, match="does not match"):
        evaluate_oracles(
            (oracle,),
            actuals=(
                OracleActual(
                    oracle_id=oracle.oracle_id,
                    kind=OracleKind.ACCESSIBILITY_TEXT,
                    subject=oracle.subject,
                    actual="https://example.test/profile",
                ),
            ),
        )
