from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.test_design import Oracle, OracleKind, OracleOperator


class OracleCheckStatus(StrEnum):
    PASSED = "passed"
    FAILED = "failed"


class OracleActual(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    oracle_id: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    kind: OracleKind
    subject: str = Field(min_length=1, max_length=500)
    actual: str | int | bool | None
    evidence_ref: str | None = Field(default=None, min_length=1, max_length=500)


class OracleCheck(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    oracle_id: str
    status: OracleCheckStatus
    expected: str | int | bool | None
    actual: str | int | bool | None
    evidence_ref: str | None


class OracleEvaluationResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    passed: bool
    check_count: int = Field(ge=1)
    checks: tuple[OracleCheck, ...] = Field(min_length=1)


class OracleEvaluationError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"oracle evaluation requires {reason}")


def evaluate_oracles(
    oracles: tuple[Oracle, ...],
    *,
    actuals: tuple[OracleActual, ...],
) -> OracleEvaluationResult:
    oracle_ids = [oracle.oracle_id for oracle in oracles]
    actual_ids = [actual.oracle_id for actual in actuals]
    if (
        not oracles
        or len(oracle_ids) != len(set(oracle_ids))
        or len(actual_ids) != len(set(actual_ids))
        or set(actual_ids) != set(oracle_ids)
    ):
        raise OracleEvaluationError("exactly one actual for every distinct oracle")

    actual_by_id = {actual.oracle_id: actual for actual in actuals}
    checks: list[OracleCheck] = []
    for oracle in oracles:
        actual = actual_by_id[oracle.oracle_id]
        if actual.kind is not oracle.kind or actual.subject != oracle.subject:
            raise OracleEvaluationError("an actual that does not match its oracle")
        passed = _compare(oracle, actual.actual)
        checks.append(
            OracleCheck(
                oracle_id=oracle.oracle_id,
                status=(
                    OracleCheckStatus.PASSED if passed else OracleCheckStatus.FAILED
                ),
                expected=oracle.expected,
                actual=actual.actual,
                evidence_ref=actual.evidence_ref,
            )
        )

    return OracleEvaluationResult(
        passed=all(check.status is OracleCheckStatus.PASSED for check in checks),
        check_count=len(checks),
        checks=tuple(checks),
    )


def _compare(oracle: Oracle, actual: str | int | bool | None) -> bool:
    if oracle.operator is OracleOperator.ABSENT:
        return actual is None
    if oracle.operator is OracleOperator.EQUALS:
        return actual == oracle.expected
    if oracle.operator is OracleOperator.CONTAINS:
        if not isinstance(actual, str) or not isinstance(oracle.expected, str):
            raise OracleEvaluationError("string values for contains comparisons")
        return oracle.expected in actual
    if (
        isinstance(actual, bool)
        or not isinstance(actual, int)
        or isinstance(oracle.expected, bool)
        or not isinstance(oracle.expected, int)
    ):
        raise OracleEvaluationError("integer values for bounded comparisons")
    if oracle.operator is OracleOperator.AT_LEAST:
        return actual >= oracle.expected
    if oracle.operator is OracleOperator.AT_MOST:
        return actual <= oracle.expected
    raise OracleEvaluationError("a supported operator")


__all__ = [
    "OracleActual",
    "OracleCheck",
    "OracleCheckStatus",
    "OracleEvaluationError",
    "OracleEvaluationResult",
    "evaluate_oracles",
]
