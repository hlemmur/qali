from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.test_plan_workflow import PlanReview


def test_rejected_plan_review_requires_actionable_feedback() -> None:
    with pytest.raises(ValidationError, match="rejected plan review"):
        PlanReview(approved=False, feedback=())


def test_approved_plan_review_cannot_include_feedback() -> None:
    with pytest.raises(ValidationError, match="approved plan review"):
        PlanReview(approved=True, feedback=("Change the plan.",))
