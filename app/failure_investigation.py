from __future__ import annotations

import hashlib
import json
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.oracle_evaluation import OracleCheck, OracleCheckStatus

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_TIMESTAMP = re.compile(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b")
_UUID = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
_PROCESS_ID = re.compile(r"\bpid[=: ]\d+\b", re.IGNORECASE)
_PORT = re.compile(r":\d{4,5}(?=[\s/,)\]]|$)")
_TEMP_PATH = re.compile(r"/(?:tmp|private/tmp)/[^\s]+")
_MEMORY_ADDRESS = re.compile(r"\b0x[0-9a-f]{8,16}\b", re.IGNORECASE)
_REQUEST_ID = re.compile(
    r"\b(?:request[_-]?id|trace[_-]?id|correlation[_-]?id)"
    r"[=: ][\"']?[a-zA-Z0-9-]+",
    re.IGNORECASE,
)
_SOURCE_LINE = re.compile(r"(?P<file>\b[^\s:]+\.[a-zA-Z0-9]+):\d+(?::\d+)?")
_WHITESPACE = re.compile(r"\s+")


class FailureFingerprintInput(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    feature_slug: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    scenario_id: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    failed_checks: tuple[OracleCheck, ...] = Field(min_length=1, max_length=40)

    @field_validator("failed_checks")
    @classmethod
    def require_distinct_failed_checks(
        cls,
        value: tuple[OracleCheck, ...],
    ) -> tuple[OracleCheck, ...]:
        oracle_ids = [check.oracle_id for check in value]
        if any(check.status is not OracleCheckStatus.FAILED for check in value) or len(
            oracle_ids
        ) != len(set(oracle_ids)):
            raise ValueError("fingerprint input requires distinct failed checks")
        return value


def normalize_failure_value(value: str | int | bool | None) -> object:
    if not isinstance(value, str):
        return value
    normalized = _ANSI.sub("", value)
    normalized = _TIMESTAMP.sub("<TIMESTAMP>", normalized)
    normalized = _UUID.sub("<UUID>", normalized)
    normalized = _PROCESS_ID.sub("pid=<PID>", normalized)
    normalized = _PORT.sub(":<PORT>", normalized)
    normalized = _TEMP_PATH.sub("<TMPPATH>", normalized)
    normalized = _MEMORY_ADDRESS.sub("<ADDR>", normalized)
    normalized = _REQUEST_ID.sub("<REQ_ID>", normalized)
    normalized = _SOURCE_LINE.sub(r"\g<file>:<LINE>", normalized)
    return _WHITESPACE.sub(" ", normalized).strip()


def failure_fingerprint(value: FailureFingerprintInput) -> str:
    canonical = {
        "project_id": value.project_id,
        "feature_slug": value.feature_slug,
        "scenario_id": value.scenario_id,
        "failed_checks": [
            {
                "oracle_id": check.oracle_id,
                "expected": normalize_failure_value(check.expected),
                "actual": normalize_failure_value(check.actual),
            }
            for check in sorted(value.failed_checks, key=lambda check: check.oracle_id)
        ],
    }
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


__all__ = [
    "FailureFingerprintInput",
    "failure_fingerprint",
    "normalize_failure_value",
]
