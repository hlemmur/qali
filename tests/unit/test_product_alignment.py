from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.product_alignment import (
    GroundedProductStatement,
    ProductAlignmentStatus,
    ProductIntent,
)


def _user_value() -> GroundedProductStatement:
    return GroundedProductStatement(
        statement="Customers can keep their profile current.",
        source_ids=("source-profile",),
    )


def _scope() -> tuple[GroundedProductStatement, ...]:
    return (
        GroundedProductStatement(
            statement="Profile display name",
            source_ids=("source-profile",),
        ),
    )


def test_product_intent_grounds_user_value_in_project_knowledge() -> None:
    intent = ProductIntent(
        project_id="project-alpha",
        feature_name="Profile editing",
        user_value=GroundedProductStatement(
            statement="Customers can keep their visible identity current.",
            source_ids=("source-profile",),
        ),
        expected_behaviors=(
            GroundedProductStatement(
                statement="The saved display name is shown.",
                source_ids=("source-profile",),
            ),
        ),
        prerequisites=(),
        in_scope=_scope(),
        out_of_scope=(),
        ambiguities=(),
        status=ProductAlignmentStatus.READY,
    )

    assert intent.user_value.source_ids == ("source-profile",)
    assert intent.in_scope[0].source_ids == ("source-profile",)


def test_ready_product_intent_cannot_hide_unresolved_ambiguity() -> None:
    with pytest.raises(ValidationError, match="ready product intent"):
        ProductIntent(
            project_id="project-alpha",
            feature_name="Profile editing",
            user_value=_user_value(),
            expected_behaviors=(),
            prerequisites=(),
            in_scope=_scope(),
            out_of_scope=(),
            ambiguities=("The save confirmation is unspecified.",),
            status=ProductAlignmentStatus.READY,
        )


def test_product_intent_requires_reason_for_clarification() -> None:
    with pytest.raises(ValidationError, match="clarification reason"):
        ProductIntent(
            project_id="project-alpha",
            feature_name="Profile editing",
            user_value=_user_value(),
            expected_behaviors=(),
            prerequisites=(),
            in_scope=_scope(),
            out_of_scope=(),
            ambiguities=(),
            status=ProductAlignmentStatus.NEEDS_CLARIFICATION,
        )


def test_ready_product_intent_requires_grounded_expected_behavior() -> None:
    with pytest.raises(ValidationError, match="expected behavior"):
        ProductIntent(
            project_id="project-alpha",
            feature_name="Profile editing",
            user_value=_user_value(),
            expected_behaviors=(),
            prerequisites=(),
            in_scope=_scope(),
            out_of_scope=(),
            ambiguities=(),
            status=ProductAlignmentStatus.READY,
        )
