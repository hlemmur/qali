from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Protocol, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.browser_policy import (
    BrowserAction,
    BrowserActionKind,
    BrowserTargetPolicy,
    CaptureEvidenceAction,
    ClickAction,
    FillCredentialAction,
    NavigateAction,
    ObserveOracleAction,
    SnapshotAction,
    TypeTextAction,
    WaitForAction,
    authorize_browser_action,
    validate_browser_location,
)
from app.oracle_evaluation import OracleActual
from app.test_design import Oracle, OracleKind

_Result = TypeVar("_Result")


class AccessibilitySnapshot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    current_url: str = Field(min_length=1, max_length=2_048)
    accessibility_tree: str = Field(max_length=200_000)


class BackendObservation(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    actual: str | int | bool | None
    evidence_ref: str | None = Field(default=None, min_length=1, max_length=500)


class BrowserActionResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    action_kind: BrowserActionKind
    current_url: str = Field(min_length=1, max_length=2_048)
    snapshot: AccessibilitySnapshot | None = None
    oracle_actual: OracleActual | None = None
    evidence_ref: str | None = Field(default=None, min_length=1, max_length=500)


class BrowserBackend(Protocol):
    async def start(self) -> None: ...

    async def close(self) -> None: ...

    async def navigate(self, url: str) -> str: ...

    async def snapshot(self) -> AccessibilitySnapshot: ...

    async def click(self, ref: str) -> str: ...

    async def type_text(self, ref: str, text: str) -> str: ...

    async def fill_secret(self, ref: str, secret: str) -> str: ...

    async def wait_for(self, text: str, state: str) -> str: ...

    async def observe(
        self,
        kind: OracleKind,
        subject: str,
    ) -> BackendObservation: ...

    async def capture_evidence(self, reason: str) -> str: ...


class CredentialResolver(Protocol):
    async def resolve(self, secret_ref: str) -> str: ...


class BrowserSessionError(RuntimeError):
    pass


class BrowserStepLimitExceeded(BrowserSessionError):
    def __init__(self) -> None:
        super().__init__("browser step budget exceeded")


class BrowserTimeoutExceeded(BrowserSessionError):
    def __init__(self) -> None:
        super().__init__("browser session timeout exceeded")


class RestrictedBrowserSession:
    def __init__(
        self,
        *,
        policy: BrowserTargetPolicy,
        approved_oracles: tuple[Oracle, ...],
        backend: BrowserBackend,
        credentials: CredentialResolver,
    ) -> None:
        self._policy = policy
        self._oracles = {oracle.oracle_id: oracle for oracle in approved_oracles}
        if len(self._oracles) != len(approved_oracles):
            raise ValueError("approved browser oracles must have distinct IDs")
        self._backend = backend
        self._credentials = credentials
        self._current_url: str | None = None
        self._steps = 0
        self._observed_actuals: list[OracleActual] = []
        self._started_at: float | None = None

    @property
    def step_count(self) -> int:
        return self._steps

    @property
    def observed_actuals(self) -> tuple[OracleActual, ...]:
        return tuple(self._observed_actuals)

    async def __aenter__(self) -> RestrictedBrowserSession:
        if self._started_at is not None:
            raise BrowserSessionError("browser session is already active")
        try:
            await asyncio.wait_for(
                self._backend.start(),
                timeout=self._policy.timeout_seconds,
            )
        except TimeoutError:
            raise BrowserTimeoutExceeded from None
        self._started_at = time.monotonic()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        try:
            await self._backend.close()
        finally:
            self._started_at = None
            self._current_url = None

    async def execute(self, action: BrowserAction) -> BrowserActionResult:
        if self._started_at is None:
            raise BrowserSessionError("browser session is not active")
        if self._steps >= self._policy.max_steps:
            raise BrowserStepLimitExceeded
        authorize_browser_action(
            action,
            policy=self._policy,
            current_url=self._current_url,
        )
        self._steps += 1
        return await self._within_timeout(lambda: self._execute_authorized(action))

    async def _execute_authorized(
        self,
        action: BrowserAction,
    ) -> BrowserActionResult:
        if isinstance(action, NavigateAction):
            current_url = await self._backend.navigate(action.url)
            self._set_current_url(current_url)
            return self._result(action.kind)
        if isinstance(action, SnapshotAction):
            snapshot = await self._backend.snapshot()
            self._set_current_url(snapshot.current_url)
            return self._result(action.kind, snapshot=snapshot)
        if isinstance(action, ClickAction):
            self._set_current_url(await self._backend.click(action.ref))
            return self._result(action.kind)
        if isinstance(action, TypeTextAction):
            self._set_current_url(
                await self._backend.type_text(action.ref, action.text)
            )
            return self._result(action.kind)
        if isinstance(action, FillCredentialAction):
            reference = next(
                item
                for item in self._policy.credential_references
                if item.name == action.credential_name
            )
            secret = await self._credentials.resolve(reference.secret_ref)
            self._set_current_url(await self._backend.fill_secret(action.ref, secret))
            return self._result(action.kind)
        if isinstance(action, WaitForAction):
            self._set_current_url(
                await self._backend.wait_for(action.text, action.state)
            )
            return self._result(action.kind)
        if isinstance(action, ObserveOracleAction):
            oracle = self._oracles.get(action.oracle_id)
            if oracle is None:
                raise BrowserSessionError("oracle is not part of the approved plan")
            if oracle.oracle_id in {
                actual.oracle_id for actual in self._observed_actuals
            }:
                raise BrowserSessionError("oracle was already observed")
            observation = await self._backend.observe(oracle.kind, oracle.subject)
            actual = OracleActual(
                oracle_id=oracle.oracle_id,
                kind=oracle.kind,
                subject=oracle.subject,
                actual=observation.actual,
                evidence_ref=observation.evidence_ref,
            )
            self._observed_actuals.append(actual)
            return self._result(action.kind, oracle_actual=actual)
        if isinstance(action, CaptureEvidenceAction):
            evidence_ref = await self._backend.capture_evidence(action.reason)
            return self._result(action.kind, evidence_ref=evidence_ref)
        raise BrowserSessionError("unsupported browser action")

    async def _within_timeout(
        self,
        operation: Callable[[], Awaitable[_Result]],
    ) -> _Result:
        assert self._started_at is not None
        elapsed = time.monotonic() - self._started_at
        remaining = self._policy.timeout_seconds - elapsed
        if remaining <= 0:
            raise BrowserTimeoutExceeded
        try:
            return await asyncio.wait_for(operation(), timeout=remaining)
        except TimeoutError:
            raise BrowserTimeoutExceeded from None

    def _set_current_url(self, url: str) -> None:
        self._current_url = validate_browser_location(url, policy=self._policy)

    def _result(
        self,
        action_kind: BrowserActionKind,
        *,
        snapshot: AccessibilitySnapshot | None = None,
        oracle_actual: OracleActual | None = None,
        evidence_ref: str | None = None,
    ) -> BrowserActionResult:
        if self._current_url is None:
            raise BrowserSessionError("browser has no approved current page")
        return BrowserActionResult(
            action_kind=action_kind,
            current_url=self._current_url,
            snapshot=snapshot,
            oracle_actual=oracle_actual,
            evidence_ref=evidence_ref,
        )


__all__ = [
    "AccessibilitySnapshot",
    "BackendObservation",
    "BrowserActionResult",
    "BrowserSessionError",
    "BrowserStepLimitExceeded",
    "BrowserTimeoutExceeded",
    "RestrictedBrowserSession",
]
