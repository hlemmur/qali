from __future__ import annotations

from typing import Protocol

from app.knowledge_workflow import KnowledgeAnalysisTask
from app.raw_source_repository import RawSourceArtifact, RawSourceSnapshot
from app.source_text_extraction import SourceTextExtractor


class SourceIndex(Protocol):
    async def list_for_project(
        self,
        project_id: str,
    ) -> tuple[RawSourceArtifact, ...]: ...


class RawSourceRepository(Protocol):
    async def read(self, artifact: RawSourceArtifact) -> RawSourceSnapshot: ...


class KnowledgeSourcesUnavailable(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project has no indexed knowledge sources")


class KnowledgeSourceLimitExceeded(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project knowledge source count exceeds limit")


class KnowledgeSourceIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("knowledge source preparation integrity failed")


class KnowledgeSourceLoader:
    def __init__(
        self,
        *,
        source_index: SourceIndex,
        raw_sources: RawSourceRepository,
        extractor: SourceTextExtractor,
    ) -> None:
        self._source_index = source_index
        self._raw_sources = raw_sources
        self._extractor = extractor

    async def load(
        self,
        project_id: str,
        *,
        expected_generation: int,
    ) -> KnowledgeAnalysisTask:
        artifacts = await self._source_index.list_for_project(project_id)
        if not artifacts:
            raise KnowledgeSourcesUnavailable
        if len(artifacts) > 20:
            raise KnowledgeSourceLimitExceeded
        if any(artifact.project_id != project_id for artifact in artifacts):
            raise KnowledgeSourceIntegrityError
        sources = []
        for artifact in artifacts:
            snapshot = await self._raw_sources.read(artifact)
            if snapshot.artifact != artifact:
                raise KnowledgeSourceIntegrityError
            sources.append(self._extractor.extract(snapshot))
        return KnowledgeAnalysisTask(
            project_id=project_id,
            sources=tuple(sources),
            expected_generation=expected_generation,
        )


__all__ = [
    "KnowledgeSourceIntegrityError",
    "KnowledgeSourceLimitExceeded",
    "KnowledgeSourceLoader",
    "KnowledgeSourcesUnavailable",
]
