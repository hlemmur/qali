from __future__ import annotations

import hashlib
from datetime import UTC, datetime

import pytest

from app.knowledge_source_loader import (
    KnowledgeSourceIntegrityError,
    KnowledgeSourceLimitExceeded,
    KnowledgeSourceLoader,
    KnowledgeSourcesUnavailable,
)
from app.raw_source_repository import (
    RawSourceArtifact,
    RawSourceProvenance,
    RawSourceSnapshot,
)
from app.source_text_extraction import SourceTextExtractor


class _SourceIndexDouble:
    def __init__(self, artifacts: tuple[RawSourceArtifact, ...]) -> None:
        self._artifacts = artifacts

    async def list_for_project(
        self,
        project_id: str,
    ) -> tuple[RawSourceArtifact, ...]:
        assert project_id == "project-alpha"
        return self._artifacts


class _RawSourceRepositoryDouble:
    def __init__(self, snapshots: dict[str, RawSourceSnapshot]) -> None:
        self._snapshots = snapshots
        self.read_source_ids: list[str] = []

    async def read(self, artifact: RawSourceArtifact) -> RawSourceSnapshot:
        self.read_source_ids.append(artifact.source_id)
        return self._snapshots[artifact.source_id]


def _snapshot(source_id: str, content: bytes) -> RawSourceSnapshot:
    artifact = RawSourceArtifact(
        project_id="project-alpha",
        source_id=source_id,
        object_name=f"projects/project-alpha/raw/{source_id}/source",
        source_uri="https://docs.example.test/product.md",
        source_uri_sha256="a" * 64,
        content_type="text/markdown",
        sha256=hashlib.sha256(content).hexdigest(),
        captured_at=datetime(2026, 9, 4, 9, 0, tzinfo=UTC),
        provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
        screening_scanners=("malware-v1", "instruction-v1"),
    )
    return RawSourceSnapshot(artifact=artifact, content=content)


@pytest.mark.asyncio
async def test_durable_raw_source_is_prepared_for_knowledge_analysis() -> None:
    snapshot = _snapshot("source-001", b"# Product\nCustomers can edit profiles.")
    loader = KnowledgeSourceLoader(
        source_index=_SourceIndexDouble((snapshot.artifact,)),
        raw_sources=_RawSourceRepositoryDouble({snapshot.artifact.source_id: snapshot}),
        extractor=SourceTextExtractor(),
    )

    task = await loader.load("project-alpha", expected_generation=0)

    assert task.project_id == "project-alpha"
    assert task.expected_generation == 0
    assert len(task.sources) == 1
    assert task.sources[0].source_id == "source-001"
    assert task.sources[0].text == "# Product Customers can edit profiles."


@pytest.mark.asyncio
async def test_project_without_indexed_sources_fails_before_raw_storage_access() -> (
    None
):
    raw_sources = _RawSourceRepositoryDouble({})
    loader = KnowledgeSourceLoader(
        source_index=_SourceIndexDouble(()),
        raw_sources=raw_sources,
        extractor=SourceTextExtractor(),
    )

    with pytest.raises(KnowledgeSourcesUnavailable) as caught:
        await loader.load("project-alpha", expected_generation=0)

    assert str(caught.value) == "project has no indexed knowledge sources"
    assert raw_sources.read_source_ids == []


@pytest.mark.asyncio
async def test_oversized_source_index_fails_before_raw_storage_access() -> None:
    artifacts = tuple(
        _snapshot(f"source-{index:03d}", f"Source {index}".encode()).artifact
        for index in range(21)
    )
    raw_sources = _RawSourceRepositoryDouble({})
    loader = KnowledgeSourceLoader(
        source_index=_SourceIndexDouble(artifacts),
        raw_sources=raw_sources,
        extractor=SourceTextExtractor(),
    )

    with pytest.raises(KnowledgeSourceLimitExceeded) as caught:
        await loader.load("project-alpha", expected_generation=0)

    assert str(caught.value) == "project knowledge source count exceeds limit"
    assert raw_sources.read_source_ids == []


@pytest.mark.asyncio
async def test_raw_snapshot_mismatch_fails_closed() -> None:
    indexed = _snapshot("source-001", b"Indexed source")
    substituted = _snapshot("source-002", b"Substituted source")
    loader = KnowledgeSourceLoader(
        source_index=_SourceIndexDouble((indexed.artifact,)),
        raw_sources=_RawSourceRepositoryDouble(
            {indexed.artifact.source_id: substituted}
        ),
        extractor=SourceTextExtractor(),
    )

    with pytest.raises(KnowledgeSourceIntegrityError) as caught:
        await loader.load("project-alpha", expected_generation=0)

    assert str(caught.value) == "knowledge source preparation integrity failed"


@pytest.mark.asyncio
async def test_cross_project_index_result_fails_before_raw_storage_access() -> None:
    indexed = _snapshot("source-001", b"Other project source").artifact.model_copy(
        update={
            "project_id": "project-beta",
            "object_name": "projects/project-beta/raw/source-001/source",
        }
    )
    raw_sources = _RawSourceRepositoryDouble({})
    loader = KnowledgeSourceLoader(
        source_index=_SourceIndexDouble((indexed,)),
        raw_sources=raw_sources,
        extractor=SourceTextExtractor(),
    )

    with pytest.raises(KnowledgeSourceIntegrityError):
        await loader.load("project-alpha", expected_generation=0)

    assert raw_sources.read_source_ids == []
