from __future__ import annotations

from app.failure_investigation import FailureFingerprintInput, failure_fingerprint
from app.oracle_evaluation import OracleCheck, OracleCheckStatus


def _failed_check(*, actual: str) -> OracleCheck:
    return OracleCheck(
        oracle_id="oracle-profile-name",
        status=OracleCheckStatus.FAILED,
        expected="Updated Name",
        actual=actual,
        evidence_ref="evidence://oracle/profile-name",
    )


def _fingerprint(actual: str) -> str:
    return failure_fingerprint(
        FailureFingerprintInput(
            project_id="project-alpha",
            feature_slug="profile-editing",
            scenario_id="scenario-profile-save",
            failed_checks=(_failed_check(actual=actual),),
        )
    )


def test_fingerprint_ignores_runtime_noise_but_keeps_failure_identity() -> None:
    first = _fingerprint(
        "2026-09-07T10:20:30.123Z pid=1234 request_id=req-123 "
        "TypeError: field 'name' failed at profile.py:142 on 127.0.0.1:54321"
    )
    second = _fingerprint(
        "2026-09-08T11:22:33.456Z pid=9876 request_id=req-999 "
        "TypeError: field 'name' failed at profile.py:870 on 127.0.0.1:61234"
    )

    assert first == second
    assert len(first) == 16


def test_fingerprint_distinguishes_meaningfully_different_failures() -> None:
    assert _fingerprint("TypeError: field 'name' failed") != _fingerprint(
        "RangeError: field 'name' failed"
    )
    assert _fingerprint("TypeError: field 'name' failed") != _fingerprint(
        "TypeError: field 'email' failed"
    )


def test_fingerprint_is_independent_of_evidence_storage_location() -> None:
    first = FailureFingerprintInput(
        project_id="project-alpha",
        feature_slug="profile-editing",
        scenario_id="scenario-profile-save",
        failed_checks=(_failed_check(actual="Original Name"),),
    )
    second = first.model_copy(
        update={
            "failed_checks": (
                first.failed_checks[0].model_copy(
                    update={"evidence_ref": "evidence://different/run"}
                ),
            )
        }
    )

    assert failure_fingerprint(first) == failure_fingerprint(second)
