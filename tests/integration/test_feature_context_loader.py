from __future__ import annotations

import pytest

from app.feature_context_loader import (
    ApprovedFeatureRequestTaskLoader,
    FeatureContextUnavailable,
    FeatureProjectContext,
)
from app.feature_worker_job import FeatureTestJob
from app.knowledge_quality import KnowledgeReadiness
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_product_alignment_agent import _task as _alignment_task
from tests.integration.test_slack_feature_results import _message


class _Contexts:
    def __init__(self, context: FeatureProjectContext) -> None:
        self.context = context
        self.project_ids = []

    async def load(self, project_id: str) -> FeatureProjectContext:
        self.project_ids.append(project_id)
        return self.context


def _job() -> FeatureTestJob:
    return FeatureTestJob(
        job_id="slack:Ev-feature-context-001",
        source_event_id="Ev-feature-context-001",
        project_id="project-alpha",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788534000.001000",
        run_id="run-profile-context",
        feature_slug="profile-editing",
        request_text="Test profile display-name editing.",
    )


def _context() -> FeatureProjectContext:
    return FeatureProjectContext(
        project_id="project-alpha",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        readiness=KnowledgeReadiness.READY,
        knowledge=_alignment_task().knowledge,
        target_policy=_execution_task().target_policy,
    )


@pytest.mark.asyncio
async def test_ready_approved_project_context_builds_a_live_feature_request() -> None:
    context = _context()
    contexts = _Contexts(context)
    loader = ApprovedFeatureRequestTaskLoader(contexts=contexts)

    task = await loader.load(_job(), progress_message=_message())

    assert contexts.project_ids == ["project-alpha"]
    assert task.alignment_task.project_id == context.project_id
    assert task.alignment_task.request == _job().request_text
    assert task.alignment_task.knowledge == context.knowledge
    assert task.run_id == _job().run_id
    assert task.feature_slug == _job().feature_slug
    assert task.target_policy == context.target_policy
    assert task.progress_message == _message()
    assert task.mock_mode is False


class _UnavailableContexts:
    async def load(self, project_id: str) -> FeatureProjectContext:
        raise RuntimeError(f"provider could not read {project_id}")


@pytest.mark.asyncio
async def test_context_provider_failure_is_redacted_and_fails_closed() -> None:
    loader = ApprovedFeatureRequestTaskLoader(contexts=_UnavailableContexts())

    with pytest.raises(
        FeatureContextUnavailable,
        match=r"^approved feature context is unavailable$",
    ) as caught:
        await loader.load(_job(), progress_message=_message())

    assert "project-alpha" not in str(caught.value)


@pytest.mark.asyncio
async def test_unready_project_context_cannot_reach_feature_planning() -> None:
    context = _context().model_copy(
        update={"readiness": KnowledgeReadiness.INSUFFICIENT}
    )
    loader = ApprovedFeatureRequestTaskLoader(contexts=_Contexts(context))

    with pytest.raises(FeatureContextUnavailable, match="knowledge is not ready"):
        await loader.load(_job(), progress_message=_message())


@pytest.mark.asyncio
async def test_project_context_must_belong_to_the_jobs_slack_scope() -> None:
    context = _context().model_copy(update={"channel_id": "C-OTHER"})
    loader = ApprovedFeatureRequestTaskLoader(contexts=_Contexts(context))

    with pytest.raises(FeatureContextUnavailable, match="does not match"):
        await loader.load(_job(), progress_message=_message())
