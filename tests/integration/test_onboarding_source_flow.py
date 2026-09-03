from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.firestore_project_repository import ProjectChannelBinding
from app.onboarding_source_flow import (
    OnboardingSourceFlow,
    OnboardingSourceLimitExceeded,
    OnboardingSourcesRequired,
)
from app.raw_source_repository import RawSourceArtifact, RawSourceProvenance
from app.slack_ingress import OnboardProjectJob
from app.source_ingestion import (
    OnboardingInlineSourceRequest,
    OnboardingSourceRequest,
)


class _ProjectRepositoryDouble:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    async def resolve_or_create(self, **kwargs: str) -> ProjectChannelBinding:
        self.calls.append(kwargs)
        return ProjectChannelBinding(
            project_id="slack-project-alpha",
            workspace_id=kwargs["workspace_id"],
            channel_id=kwargs["channel_id"],
            created_by=kwargs["created_by"],
        )


class _SourceIngestionDouble:
    def __init__(self) -> None:
        self.inline_requests: list[OnboardingInlineSourceRequest] = []
        self.url_requests: list[OnboardingSourceRequest] = []
        self.events: list[str] = []

    async def ingest_inline(
        self,
        request: OnboardingInlineSourceRequest,
    ) -> RawSourceArtifact:
        self.events.append("inline")
        self.inline_requests.append(request)
        return _artifact(request.project_id, request.source_id)

    async def ingest(self, request: OnboardingSourceRequest) -> RawSourceArtifact:
        self.events.append("url")
        self.url_requests.append(request)
        return _artifact(request.project_id, request.source_id)


def _artifact(project_id: str, source_id: str) -> RawSourceArtifact:
    return RawSourceArtifact(
        project_id=project_id,
        source_id=source_id,
        object_name=f"projects/{project_id}/raw/{source_id}/source",
        source_uri="https://docs.example.test/source",
        source_uri_sha256="a" * 64,
        content_type="text/plain",
        sha256="b" * 64,
        captured_at=datetime(2026, 9, 4, 0, 45, tzinfo=UTC),
        provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
        screening_scanners=("malware-v1", "instruction-v1"),
    )


def _job(request_text: str) -> OnboardProjectJob:
    return OnboardProjectJob(
        job_id="slack:Ev-source-flow",
        source_event_id="Ev-source-flow",
        workspace_id="T-QALI",
        channel_id="C-PROJECT",
        requester_user_id="U-OWNER",
        thread_ts="1788461100.001000",
        request_text=request_text,
    )


@pytest.mark.asyncio
async def test_source_flow_maps_project_then_ingests_text_and_urls() -> None:
    projects = _ProjectRepositoryDouble()
    ingestion = _SourceIngestionDouble()
    flow = OnboardingSourceFlow(projects=projects, ingestion=ingestion)

    await flow.process(
        _job(
            "<@U-QALI> onboard project Customers can edit profiles. "
            "https://docs.example.test/profile"
        )
    )

    assert projects.calls == [
        {
            "workspace_id": "T-QALI",
            "channel_id": "C-PROJECT",
            "created_by": "slack:U-OWNER",
        }
    ]
    assert ingestion.events == ["inline", "url"]
    [inline] = ingestion.inline_requests
    assert inline.project_id == "slack-project-alpha"
    assert inline.content == "Customers can edit profiles."
    assert inline.workspace_id == "T-QALI"
    assert inline.channel_id == "C-PROJECT"
    assert inline.source_event_id == "Ev-source-flow"
    [url] = ingestion.url_requests
    assert url.project_id == "slack-project-alpha"
    assert url.url == "https://docs.example.test/profile"
    assert inline.author_ref == url.author_ref == "slack:U-OWNER"


@pytest.mark.asyncio
async def test_empty_source_request_fails_before_project_creation() -> None:
    projects = _ProjectRepositoryDouble()
    flow = OnboardingSourceFlow(
        projects=projects,
        ingestion=_SourceIngestionDouble(),
    )

    with pytest.raises(OnboardingSourcesRequired):
        await flow.process(_job("<@U-QALI> onboard project"))

    assert projects.calls == []


@pytest.mark.asyncio
async def test_source_count_limit_fails_before_project_creation() -> None:
    projects = _ProjectRepositoryDouble()
    flow = OnboardingSourceFlow(
        projects=projects,
        ingestion=_SourceIngestionDouble(),
        max_sources=2,
    )

    with pytest.raises(OnboardingSourceLimitExceeded):
        await flow.process(
            _job(
                "<@U-QALI> onboard project Product notes "
                "https://one.example.test https://two.example.test"
            )
        )

    assert projects.calls == []
