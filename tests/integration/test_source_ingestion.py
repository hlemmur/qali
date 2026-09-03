from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.raw_source_repository import RawSourceArtifact, RawSourceProvenance
from app.source_fetcher import FetchedSource
from app.source_ingestion import (
    OnboardingInlineSourceRequest,
    OnboardingSourceIngestionService,
    OnboardingSourceRequest,
)
from app.source_screening import (
    ScreenedSource,
    SourceScreeningDecision,
    SourceScreeningRejected,
    SourceScreeningStage,
    SourceThreat,
)


class _FetcherDouble:
    def __init__(self, source: FetchedSource) -> None:
        self._source = source
        self.urls: list[str] = []

    async def fetch(self, url: str) -> FetchedSource:
        self.urls.append(url)
        return self._source


class _ScreenerDouble:
    def __init__(self, source: ScreenedSource) -> None:
        self._source = source
        self.sources: list[FetchedSource] = []

    async def screen(self, source: FetchedSource) -> ScreenedSource:
        self.sources.append(source)
        return self._source


class _RawRepositoryDouble:
    def __init__(self, artifact: RawSourceArtifact) -> None:
        self._artifact = artifact
        self.calls: list[dict[str, Any]] = []

    async def persist(self, **kwargs: Any) -> RawSourceArtifact:
        self.calls.append(kwargs)
        return self._artifact


class _SourceIndexDouble:
    def __init__(self) -> None:
        self.artifacts: list[RawSourceArtifact] = []

    async def create(self, artifact: RawSourceArtifact) -> bool:
        self.artifacts.append(artifact)
        return True


class _RejectingScreener:
    async def screen(self, source: FetchedSource) -> ScreenedSource:
        del source
        raise SourceScreeningRejected(
            (
                SourceScreeningDecision(
                    stage=SourceScreeningStage.MALWARE,
                    scanner="malware-v1",
                    threats=(SourceThreat.MALWARE,),
                ),
            )
        )


class _UnexpectedRawRepository:
    async def persist(self, **kwargs: Any) -> RawSourceArtifact:
        del kwargs
        raise AssertionError("rejected source must not reach raw persistence")


class _UnexpectedSourceIndex:
    async def create(self, artifact: RawSourceArtifact) -> bool:
        del artifact
        raise AssertionError("rejected source must not reach metadata indexing")


@pytest.mark.asyncio
async def test_source_is_fetched_screened_persisted_and_indexed() -> None:
    fetched = FetchedSource(
        url="https://docs.example.test/product.md",
        content_type="text/markdown",
        content=b"# Product",
    )
    screened = ScreenedSource(
        source=fetched,
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(),
            ),
            SourceScreeningDecision(
                stage=SourceScreeningStage.INSTRUCTION,
                scanner="instruction-v1",
                threats=(),
            ),
        ),
    )
    provenance = RawSourceProvenance(author_ref="slack:U-OWNER")
    artifact = RawSourceArtifact(
        project_id="project-alpha",
        source_id="source-001",
        object_name="projects/project-alpha/raw/source-001/source",
        source_uri=fetched.url,
        source_uri_sha256="a" * 64,
        content_type=fetched.content_type,
        sha256="b" * 64,
        captured_at=datetime(2026, 9, 3, 18, 15, tzinfo=UTC),
        provenance=provenance,
        screening_scanners=("malware-v1", "instruction-v1"),
    )
    fetcher = _FetcherDouble(fetched)
    screener = _ScreenerDouble(screened)
    raw_repository = _RawRepositoryDouble(artifact)
    source_index = _SourceIndexDouble()
    service = OnboardingSourceIngestionService(
        fetcher=fetcher,
        screener=screener,
        raw_repository=raw_repository,
        source_index=source_index,
    )
    request = OnboardingSourceRequest(
        project_id="project-alpha",
        source_id="source-001",
        url=fetched.url,
        author_ref="slack:U-OWNER",
    )

    result = await service.ingest(request)

    assert result == artifact
    assert fetcher.urls == [request.url]
    assert screener.sources == [fetched]
    assert raw_repository.calls == [
        {
            "project_id": request.project_id,
            "source_id": request.source_id,
            "source": screened,
            "provenance": provenance,
        }
    ]
    assert source_index.artifacts == [artifact]


@pytest.mark.asyncio
async def test_rejected_source_stops_before_any_durable_write() -> None:
    fetched = FetchedSource(
        url="https://docs.example.test/unsafe.txt",
        content_type="text/plain",
        content=b"unsafe content",
    )
    service = OnboardingSourceIngestionService(
        fetcher=_FetcherDouble(fetched),
        screener=_RejectingScreener(),
        raw_repository=_UnexpectedRawRepository(),
        source_index=_UnexpectedSourceIndex(),
    )

    with pytest.raises(SourceScreeningRejected):
        await service.ingest(
            OnboardingSourceRequest(
                project_id="project-alpha",
                source_id="source-unsafe",
                url=fetched.url,
                author_ref="slack:U-OWNER",
            )
        )


@pytest.mark.asyncio
async def test_slack_text_is_screened_and_persisted_without_network_fetch() -> None:
    inline_source = FetchedSource(
        url="slack://event/" + "a" * 64,
        content_type="text/plain",
        content=b"Customers can edit their profile.",
    )
    screened = ScreenedSource(
        source=inline_source,
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(),
            ),
            SourceScreeningDecision(
                stage=SourceScreeningStage.INSTRUCTION,
                scanner="instruction-v1",
                threats=(),
            ),
        ),
    )
    artifact = RawSourceArtifact(
        project_id="project-alpha",
        source_id="slack-text-001",
        object_name="projects/project-alpha/raw/slack-text-001/source",
        source_uri=inline_source.url,
        source_uri_sha256="b" * 64,
        content_type="text/plain",
        sha256="c" * 64,
        captured_at=datetime(2026, 9, 4, 0, 15, tzinfo=UTC),
        provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
        screening_scanners=("malware-v1", "instruction-v1"),
    )
    fetcher = _FetcherDouble(inline_source)
    screener = _ScreenerDouble(screened)
    raw_repository = _RawRepositoryDouble(artifact)
    source_index = _SourceIndexDouble()
    service = OnboardingSourceIngestionService(
        fetcher=fetcher,
        screener=screener,
        raw_repository=raw_repository,
        source_index=source_index,
    )

    result = await service.ingest_inline(
        OnboardingInlineSourceRequest(
            project_id="project-alpha",
            source_id="slack-text-001",
            workspace_id="T-QALI",
            channel_id="C-PROJECT",
            source_event_id="Ev-text",
            content="Customers can edit their profile.",
            author_ref="slack:U-OWNER",
        )
    )

    assert result == artifact
    assert fetcher.urls == []
    [received] = screener.sources
    assert received.content == b"Customers can edit their profile."
    assert received.content_type == "text/plain"
    assert received.url.startswith("slack://event/")
    assert "T-QALI" not in received.url
    assert "C-PROJECT" not in received.url
    assert source_index.artifacts == [artifact]


def test_slack_text_request_rejects_content_above_the_inline_limit() -> None:
    with pytest.raises(ValueError, match="at most 20000 characters"):
        OnboardingInlineSourceRequest(
            project_id="project-alpha",
            source_id="slack-text-too-large",
            workspace_id="T-QALI",
            channel_id="C-PROJECT",
            source_event_id="Ev-too-large",
            content="x" * 20_001,
            author_ref="slack:U-OWNER",
        )
