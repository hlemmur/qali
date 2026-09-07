from __future__ import annotations

from typing import Any

import pytest

from app.failure_investigation import (
    FailureInvestigationTask,
    FailureInvestigationWorkflow,
    FailureReview,
)
from app.run_artifacts import FeatureRunRecord
from app.slack_feature_results import (
    InMemorySlackFeatureResultPublisher,
    SlackFeatureResultPublisher,
    render_feature_result,
    render_finding_follow_up,
)
from app.slack_progress import ProgressMessage
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_failure_investigation_workflow import (
    _attempt,
    _InvestigatorDouble,
    _ReproducerDouble,
    _result,
    _ReviewerDouble,
)
from tests.integration.test_plan_reviewer_agent import _review_task
from tests.integration.test_run_artifacts import _failed_run


class _SlackClient:
    def __init__(self) -> None:
        self.updates: list[dict[str, Any]] = []

    async def chat_update(self, **kwargs: Any) -> dict[str, Any]:
        self.updates.append(kwargs)
        return {"ok": True}


def _message() -> ProgressMessage:
    return ProgressMessage(
        channel_id="C-QALI",
        thread_ts="1788220800.030000",
        message_ts="1788220801.030000",
    )


def _successful_run() -> FeatureRunRecord:
    return FeatureRunRecord(
        project_id="project-alpha",
        run_id="run-profile-success",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        plan=_review_task().plan,
        scenario_results=(_result(passed=True),),
        investigations=(),
    )


def test_success_result_is_concise_and_mock_mode_is_visible() -> None:
    rendered = render_feature_result(_successful_run(), mock_mode=True)

    assert rendered.text == (
        "[MOCK MODE]\nProfile display-name editing: 1 scenario passed (2 checks)."
    )


@pytest.mark.asyncio
async def test_failed_result_leads_with_counts_and_specific_findings() -> None:
    record = await _failed_run()

    rendered = render_feature_result(record, mock_mode=False)

    finding = record.investigations[0].finding
    assert finding is not None
    assert rendered.text.startswith(
        "Profile display-name editing: 0/1 scenarios passed (2 checks)."
    )
    assert f"{finding.finding_id}: {finding.summary}" in rendered.text
    assert "fingerprint" not in rendered.text.lower()
    assert "context-initial" not in rendered.text
    assert "secret_ref" not in rendered.text


@pytest.mark.asyncio
async def test_finding_follow_up_uses_persisted_grounded_evidence() -> None:
    record = await _failed_run()
    finding = record.investigations[0].finding
    assert finding is not None

    rendered = render_finding_follow_up(
        record,
        finding.finding_id,
        mock_mode=True,
    )

    assert rendered.text.startswith(f"[MOCK MODE]\n{finding.finding_id}:")
    assert "Change and save the display name." in rendered.text
    assert "Expected: Updated Name" in rendered.text
    assert "Actual: Original Name" in rendered.text
    assert "evidence://initial/trace" in rendered.text
    assert "fingerprint" not in rendered.text.lower()


@pytest.mark.asyncio
async def test_inconclusive_failure_does_not_claim_a_confirmed_finding() -> None:
    execution_task = _execution_task()
    investigation = await FailureInvestigationWorkflow(
        reproducer=_ReproducerDouble(_attempt(passed=True, run="reproduction")),
        investigator=_InvestigatorDouble([]),
        reviewer=_ReviewerDouble([FailureReview(approved=True, feedback=())]),
    ).run(
        FailureInvestigationTask(
            project_id=execution_task.project_id,
            feature_slug="profile-editing",
            execution_task=execution_task,
            initial_attempt=_attempt(passed=False, run="initial"),
        )
    )
    record = FeatureRunRecord(
        project_id="project-alpha",
        run_id="run-profile-inconclusive",
        feature_slug="profile-editing",
        request_markdown="Test profile display-name editing.",
        plan=_review_task().plan,
        scenario_results=(_result(passed=False),),
        investigations=(investigation,),
    )

    rendered = render_feature_result(record, mock_mode=False)

    assert "No confirmed finding:" in rendered.text
    assert "Failure did not reproduce in a fresh isolated context." in rendered.text
    assert "finding-" not in rendered.text


@pytest.mark.asyncio
async def test_result_publishers_update_the_existing_thread_message() -> None:
    rendered = render_feature_result(_successful_run(), mock_mode=False)
    client = _SlackClient()
    publisher = SlackFeatureResultPublisher(client=client)
    mock_publisher = InMemorySlackFeatureResultPublisher()

    await publisher.publish(_message(), rendered)
    await mock_publisher.publish(_message(), rendered)
    await mock_publisher.publish(_message(), rendered)

    assert client.updates == [
        {
            "channel": "C-QALI",
            "ts": "1788220801.030000",
            "text": rendered.text,
        }
    ]
    assert mock_publisher.list_messages() == [(_message(), rendered)]
