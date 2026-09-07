from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.browser_policy import (
    BrowserActionKind,
    BrowserPolicyError,
    BrowserTargetPolicy,
    ClickAction,
    CredentialReference,
    FillCredentialAction,
    NavigateAction,
    SnapshotAction,
    TypeTextAction,
    authorize_browser_action,
)


def _policy() -> BrowserTargetPolicy:
    return BrowserTargetPolicy(
        project_id="project-alpha",
        start_url="https://app.example.test/profile",
        allowed_origins=("https://app.example.test",),
        allowed_actions=(
            BrowserActionKind.NAVIGATE,
            BrowserActionKind.SNAPSHOT,
            BrowserActionKind.CLICK_REF,
            BrowserActionKind.TYPE_TEXT,
            BrowserActionKind.FILL_CREDENTIAL,
        ),
        credential_references=(
            CredentialReference(
                name="primary-login",
                secret_ref="projects/project-alpha/secrets/primary-login",
            ),
        ),
        safe_consequential_actions=("save-profile",),
        max_steps=12,
        timeout_seconds=300,
    )


def test_target_policy_requires_a_canonical_https_origin() -> None:
    with pytest.raises(ValidationError, match="canonical HTTPS origin"):
        BrowserTargetPolicy(
            project_id="project-alpha",
            start_url="https://app.example.test/profile",
            allowed_origins=("https://app.example.test/path",),
            allowed_actions=(BrowserActionKind.NAVIGATE,),
            credential_references=(),
            safe_consequential_actions=(),
            max_steps=12,
            timeout_seconds=300,
        )


def test_navigation_is_limited_to_the_configured_origin() -> None:
    assert (
        authorize_browser_action(
            NavigateAction(url="https://app.example.test/settings"),
            policy=_policy(),
            current_url=None,
        ).url
        == "https://app.example.test/settings"
    )

    with pytest.raises(BrowserPolicyError, match="origin"):
        authorize_browser_action(
            NavigateAction(url="https://attacker.example/collect"),
            policy=_policy(),
            current_url=None,
        )


def test_non_navigation_actions_require_a_current_allowed_page() -> None:
    with pytest.raises(BrowserPolicyError, match="current page"):
        authorize_browser_action(
            SnapshotAction(),
            policy=_policy(),
            current_url="https://attacker.example/collect",
        )


def test_consequential_clicks_are_deny_by_default() -> None:
    with pytest.raises(BrowserPolicyError, match="consequential"):
        authorize_browser_action(
            ClickAction(ref="button-delete", consequence="delete-account"),
            policy=_policy(),
            current_url="https://app.example.test/profile",
        )

    action = authorize_browser_action(
        ClickAction(ref="button-save", consequence="save-profile"),
        policy=_policy(),
        current_url="https://app.example.test/profile",
    )
    assert action.consequence == "save-profile"


def test_credential_fill_accepts_only_an_approved_reference_name() -> None:
    policy = _policy()
    action = authorize_browser_action(
        FillCredentialAction(ref="input-password", credential_name="primary-login"),
        policy=policy,
        current_url="https://app.example.test/profile",
    )
    assert action.credential_name == "primary-login"
    assert "secret" not in action.model_dump()
    assert policy.model_dump()["credential_references"][0]["secret_ref"] == (
        "projects/project-alpha/secrets/primary-login"
    )

    with pytest.raises(BrowserPolicyError, match="credential"):
        authorize_browser_action(
            FillCredentialAction(ref="input-password", credential_name="unapproved"),
            policy=_policy(),
            current_url="https://app.example.test/profile",
        )


def test_text_actions_reject_password_like_fields() -> None:
    with pytest.raises(ValidationError, match="credential fill"):
        TypeTextAction(
            ref="input-password",
            text="do-not-put-secrets-in-agent-actions",
            field_purpose="password",
        )
