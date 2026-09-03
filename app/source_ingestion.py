from __future__ import annotations

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
        screened = await self._screener.screen(fetched)
        artifact = await self._raw_repository.persist(
            project_id=request.project_id,
            source_id=request.source_id,
            source=screened,
            provenance=RawSourceProvenance(author_ref=request.author_ref),
        )
        await self._source_index.create(artifact)
        return artifact


__all__ = [
    "OnboardingSourceIngestionService",
    "OnboardingSourceRequest",
]
