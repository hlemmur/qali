from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_CREDENTIAL_PURPOSE = re.compile(
    r"(?:password|passcode|secret|token|credential|api[-_ ]?key)",
    re.IGNORECASE,
)


class BrowserActionKind(StrEnum):
    NAVIGATE = "navigate"
    SNAPSHOT = "snapshot"
    CLICK_REF = "click_ref"
    TYPE_TEXT = "type_text"
    FILL_CREDENTIAL = "fill_credential"
    WAIT_FOR = "wait_for"
    OBSERVE_ORACLE = "observe_oracle"
    CAPTURE_EVIDENCE = "capture_evidence"


class CredentialReference(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = Field(
        min_length=3,
        max_length=128,
        pattern=r"^[a-z0-9][a-z0-9-]+$",
    )
    secret_ref: str = Field(
        min_length=3,
        max_length=500,
        pattern=r"^projects/[a-z0-9-]+/secrets/[a-zA-Z0-9_-]+$",
    )


class BrowserTargetPolicy(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1, max_length=128)
    start_url: str = Field(min_length=1, max_length=2_048)
    allowed_origins: tuple[str, ...] = Field(min_length=1, max_length=20)
    allowed_actions: tuple[BrowserActionKind, ...] = Field(min_length=1)
    credential_references: tuple[CredentialReference, ...] = Field(max_length=20)
    safe_consequential_actions: tuple[str, ...] = Field(max_length=50)
    max_steps: int = Field(gt=0, le=50)
    timeout_seconds: int = Field(gt=0, le=900)

    @field_validator("allowed_origins")
    @classmethod
    def require_canonical_origins(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(_origin(origin) != origin for origin in value):
            raise ValueError("allowed origin must be a canonical HTTPS origin")
        if len(value) != len(set(value)):
            raise ValueError("allowed origins must be distinct")
        return value

    @field_validator("allowed_actions")
    @classmethod
    def require_distinct_actions(
        cls,
        value: tuple[BrowserActionKind, ...],
    ) -> tuple[BrowserActionKind, ...]:
        if len(value) != len(set(value)):
            raise ValueError("allowed actions must be distinct")
        return value

    @model_validator(mode="after")
    def require_consistent_scope(self) -> BrowserTargetPolicy:
        if _origin(self.start_url) not in self.allowed_origins:
            raise ValueError("start URL must use an allowed origin")
        credential_names = [item.name for item in self.credential_references]
        if len(credential_names) != len(set(credential_names)):
            raise ValueError("credential reference names must be distinct")
        if len(self.safe_consequential_actions) != len(
            set(self.safe_consequential_actions)
        ):
            raise ValueError("safe consequential actions must be distinct")
        return self


class NavigateAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.NAVIGATE] = BrowserActionKind.NAVIGATE
    url: str = Field(min_length=1, max_length=2_048)


class SnapshotAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.SNAPSHOT] = BrowserActionKind.SNAPSHOT


class ClickAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.CLICK_REF] = BrowserActionKind.CLICK_REF
    ref: str = Field(min_length=1, max_length=200)
    consequence: str | None = Field(default=None, min_length=1, max_length=200)


class TypeTextAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.TYPE_TEXT] = BrowserActionKind.TYPE_TEXT
    ref: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=4_000)
    field_purpose: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def forbid_secret_text(self) -> TypeTextAction:
        if _CREDENTIAL_PURPOSE.search(self.field_purpose):
            raise ValueError("credential fill must use an approved named reference")
        return self


class FillCredentialAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.FILL_CREDENTIAL] = BrowserActionKind.FILL_CREDENTIAL
    ref: str = Field(min_length=1, max_length=200)
    credential_name: str = Field(min_length=1, max_length=128)


class WaitForAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.WAIT_FOR] = BrowserActionKind.WAIT_FOR
    text: str = Field(min_length=1, max_length=500)
    state: Literal["present", "absent"]


class ObserveOracleAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.OBSERVE_ORACLE] = BrowserActionKind.OBSERVE_ORACLE
    oracle_id: str = Field(min_length=3, max_length=128)


class CaptureEvidenceAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal[BrowserActionKind.CAPTURE_EVIDENCE] = (
        BrowserActionKind.CAPTURE_EVIDENCE
    )
    reason: str = Field(min_length=1, max_length=500)


BrowserAction = Annotated[
    NavigateAction
    | SnapshotAction
    | ClickAction
    | TypeTextAction
    | FillCredentialAction
    | WaitForAction
    | ObserveOracleAction
    | CaptureEvidenceAction,
    Field(discriminator="kind"),
]


class BrowserPolicyError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"browser action denied: {reason}")


def authorize_browser_action(
    action: BrowserAction,
    *,
    policy: BrowserTargetPolicy,
    current_url: str | None,
) -> BrowserAction:
    if action.kind not in policy.allowed_actions:
        raise BrowserPolicyError("action kind is not approved")
    if isinstance(action, NavigateAction):
        if _origin(action.url) not in policy.allowed_origins:
            raise BrowserPolicyError("navigation origin is not approved")
        return action
    if current_url is None or _origin(current_url) not in policy.allowed_origins:
        raise BrowserPolicyError("current page is outside the approved origin")
    if isinstance(action, ClickAction) and (
        action.consequence is not None
        and action.consequence not in policy.safe_consequential_actions
    ):
        raise BrowserPolicyError("consequential action is not explicitly approved")
    if isinstance(action, FillCredentialAction) and action.credential_name not in {
        item.name for item in policy.credential_references
    }:
        raise BrowserPolicyError("credential reference is not approved")
    return action


def validate_browser_location(
    url: str,
    *,
    policy: BrowserTargetPolicy,
) -> str:
    if _origin(url) not in policy.allowed_origins:
        raise BrowserPolicyError("redirect left the approved origin")
    return url


def _origin(url: str) -> str:
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("browser URLs require HTTPS without embedded credentials")
    host = parsed.hostname.lower()
    port = f":{parsed.port}" if parsed.port is not None else ""
    return f"https://{host}{port}"


__all__ = [
    "BrowserAction",
    "BrowserActionKind",
    "BrowserPolicyError",
    "BrowserTargetPolicy",
    "CaptureEvidenceAction",
    "ClickAction",
    "CredentialReference",
    "FillCredentialAction",
    "NavigateAction",
    "ObserveOracleAction",
    "SnapshotAction",
    "TypeTextAction",
    "WaitForAction",
    "authorize_browser_action",
    "validate_browser_location",
]
