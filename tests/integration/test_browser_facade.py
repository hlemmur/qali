from __future__ import annotations

import pytest

from app.browser_facade import (
    AccessibilitySnapshot,
    BackendObservation,
    BrowserStepLimitExceeded,
    RestrictedBrowserSession,
)
from app.browser_policy import (
    BrowserActionKind,
    BrowserPolicyError,
    BrowserTargetPolicy,
    CredentialReference,
    FillCredentialAction,
    NavigateAction,
    ObserveOracleAction,
    SnapshotAction,
)
from app.test_design import Oracle, OracleKind, OracleOperator


class _BackendDouble:
    def __init__(self, *, redirect_url: str | None = None) -> None:
        self.redirect_url = redirect_url
        self.started = 0
        self.closed = 0
        self.current_url = "about:blank"
        self.secret_inputs: list[tuple[str, str]] = []
        self.observations: list[tuple[OracleKind, str]] = []

    async def start(self) -> None:
        self.started += 1

    async def close(self) -> None:
        self.closed += 1

    async def navigate(self, url: str) -> str:
        self.current_url = self.redirect_url or url
        return self.current_url

    async def snapshot(self) -> AccessibilitySnapshot:
        return AccessibilitySnapshot(
            current_url=self.current_url,
            accessibility_tree='heading "Profile"\ntextbox "Display name"',
        )

    async def click(self, ref: str) -> str:
        return self.current_url

    async def type_text(self, ref: str, text: str) -> str:
        return self.current_url

    async def fill_secret(self, ref: str, secret: str) -> str:
        self.secret_inputs.append((ref, secret))
        return self.current_url

    async def wait_for(self, text: str, state: str) -> str:
        return self.current_url

    async def observe(
        self,
        kind: OracleKind,
        subject: str,
    ) -> BackendObservation:
        self.observations.append((kind, subject))
        return BackendObservation(
            actual="Updated Name",
            evidence_ref="evidence://snapshot/profile-name",
        )

    async def capture_evidence(self, reason: str) -> str:
        return "evidence://screenshot/failure"


class _CredentialResolverDouble:
    def __init__(self) -> None:
        self.references: list[str] = []

    async def resolve(self, secret_ref: str) -> str:
        self.references.append(secret_ref)
        return "private-password-value"


def _policy(*, max_steps: int = 8) -> BrowserTargetPolicy:
    return BrowserTargetPolicy(
        project_id="project-alpha",
        start_url="https://app.example.test/profile",
        allowed_origins=("https://app.example.test",),
        allowed_actions=(
            BrowserActionKind.NAVIGATE,
            BrowserActionKind.SNAPSHOT,
            BrowserActionKind.FILL_CREDENTIAL,
            BrowserActionKind.OBSERVE_ORACLE,
        ),
        credential_references=(
            CredentialReference(
                name="primary-login",
                secret_ref="projects/project-alpha/secrets/primary-login",
            ),
        ),
        safe_consequential_actions=(),
        max_steps=max_steps,
        timeout_seconds=300,
    )


def _oracle() -> Oracle:
    return Oracle(
        oracle_id="oracle-name-visible",
        kind=OracleKind.ACCESSIBILITY_TEXT,
        subject="profile display name",
        operator=OracleOperator.EQUALS,
        expected="Updated Name",
    )


@pytest.mark.asyncio
async def test_facade_exposes_only_policy_checked_typed_browser_results() -> None:
    backend = _BackendDouble()
    credentials = _CredentialResolverDouble()
    session = RestrictedBrowserSession(
        policy=_policy(),
        approved_oracles=(_oracle(),),
        backend=backend,
        credentials=credentials,
    )

    async with session:
        navigation = await session.execute(
            NavigateAction(url="https://app.example.test/profile")
        )
        snapshot = await session.execute(SnapshotAction())
        credential_fill = await session.execute(
            FillCredentialAction(
                ref="input-password",
                credential_name="primary-login",
            )
        )
        observation = await session.execute(
            ObserveOracleAction(oracle_id=_oracle().oracle_id)
        )

    assert navigation.current_url == "https://app.example.test/profile"
    assert snapshot.snapshot is not None
    assert credential_fill.model_dump_json().find("private-password-value") == -1
    assert observation.oracle_actual is not None
    assert observation.oracle_actual.actual == "Updated Name"
    assert backend.secret_inputs == [("input-password", "private-password-value")]
    assert credentials.references == ["projects/project-alpha/secrets/primary-login"]
    assert backend.started == 1
    assert backend.closed == 1
    assert session.step_count == 4
    assert session.observed_actuals == (observation.oracle_actual,)


@pytest.mark.asyncio
async def test_facade_rejects_an_unapproved_redirect() -> None:
    backend = _BackendDouble(redirect_url="https://attacker.example/collect")
    session = RestrictedBrowserSession(
        policy=_policy(),
        approved_oracles=(_oracle(),),
        backend=backend,
        credentials=_CredentialResolverDouble(),
    )

    async with session:
        with pytest.raises(BrowserPolicyError, match="redirect"):
            await session.execute(
                NavigateAction(url="https://app.example.test/profile")
            )

    assert backend.closed == 1


@pytest.mark.asyncio
async def test_facade_enforces_the_step_budget_before_backend_use() -> None:
    backend = _BackendDouble()
    session = RestrictedBrowserSession(
        policy=_policy(max_steps=1),
        approved_oracles=(_oracle(),),
        backend=backend,
        credentials=_CredentialResolverDouble(),
    )

    async with session:
        await session.execute(NavigateAction(url=_policy().start_url))
        with pytest.raises(BrowserStepLimitExceeded):
            await session.execute(SnapshotAction())

    assert backend.closed == 1
