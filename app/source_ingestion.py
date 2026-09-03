from __future__ import annotations

import hashlib
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.raw_source_repository import (
    RawSourceArtifact,
    RawSourceProvenance,
)
from app.source_fetcher import FetchedSource
from app.source_screening import ScreenedSource


class OnboardingSourceRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    author_ref: str = Field(min_length=1)


class OnboardingInlineSourceRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1, max_length=256)
    channel_id: str = Field(min_length=1, max_length=256)
    source_event_id: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=20_000)
    author_ref: str = Field(min_length=1, max_length=256)


class SourceFetcher(Protocol):
    async def fetch(self, url: str) -> FetchedSource: ...


class SourceScreener(Protocol):
    async def screen(self, source: FetchedSource) -> ScreenedSource: ...


class RawSourceRepository(Protocol):
    async def persist(
        self,
        *,
        project_id: str,
        source_id: str,
        source: ScreenedSource,
        provenance: RawSourceProvenance,
    ) -> RawSourceArtifact: ...


class SourceMetadataIndex(Protocol):
    async def create(self, artifact: RawSourceArtifact) -> bool: ...


class OnboardingSourceIngestionService:
    def __init__(
        self,
        *,
        fetcher: SourceFetcher,
        screener: SourceScreener,
        raw_repository: RawSourceRepository,
        source_index: SourceMetadataIndex,
    ) -> None:
        self._fetcher = fetcher
        self._screener = screener
        self._raw_repository = raw_repository
        self._source_index = source_index

    async def ingest(self, request: OnboardingSourceRequest) -> RawSourceArtifact:
        fetched = await self._fetcher.fetch(request.url)
        return await self._screen_persist_index(
            project_id=request.project_id,
            source_id=request.source_id,
            author_ref=request.author_ref,
            source=fetched,
        )

    async def ingest_inline(
        self,
        request: OnboardingInlineSourceRequest,
    ) -> RawSourceArtifact:
        source_scope = (
            f"{request.workspace_id}\0{request.channel_id}\0{request.source_event_id}"
        )
        source_ref = hashlib.sha256(source_scope.encode()).hexdigest()
        source = FetchedSource(
            url=f"slack://event/{source_ref}",
            content_type="text/plain",
            content=request.content.encode(),
        )
        return await self._screen_persist_index(
            project_id=request.project_id,
            source_id=request.source_id,
            author_ref=request.author_ref,
            source=source,
        )

    async def _screen_persist_index(
        self,
        *,
        project_id: str,
        source_id: str,
        author_ref: str,
        source: FetchedSource,
    ) -> RawSourceArtifact:
        screened = await self._screener.screen(source)
        artifact = await self._raw_repository.persist(
            project_id=project_id,
            source_id=source_id,
            source=screened,
            provenance=RawSourceProvenance(author_ref=author_ref),
        )
        await self._source_index.create(artifact)
        return artifact


__all__ = [
    "OnboardingInlineSourceRequest",
    "OnboardingSourceIngestionService",
    "OnboardingSourceRequest",
]
