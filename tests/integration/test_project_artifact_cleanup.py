from dataclasses import dataclass, field
from pathlib import Path

import pytest
from google.api_core.exceptions import NotFound

from app.project_artifact_cleanup import (
    DeletedArtifactVersion,
    GcsProjectArtifactCleaner,
    InMemoryProjectArtifactCleaner,
    ProjectArtifactCleanupIntegrityError,
    ProjectArtifactCleanupLimitExceeded,
    ProjectArtifactCleanupSettings,
)


@dataclass
class FakeBlob:
    name: str
    generation: int
    missing: bool = False
    deletes: list[dict[str, object]] = field(default_factory=list)

    def delete(self, **kwargs: object) -> None:
        self.deletes.append(kwargs)
        if self.missing:
            raise NotFound("already deleted")


class FakeStorageClient:
    def __init__(self, blobs: tuple[FakeBlob, ...]) -> None:
        self.blobs = blobs
        self.list_calls: list[dict[str, object]] = []

    def list_blobs(self, bucket_name: str, **kwargs: object) -> tuple[FakeBlob, ...]:
        self.list_calls.append({"bucket_name": bucket_name, **kwargs})
        return self.blobs


@pytest.mark.asyncio
async def test_project_cleanup_deletes_every_artifact_generation_in_scope() -> None:
    blobs = (
        FakeBlob("projects/project-a/runs/run-2/result.json", 4),
        FakeBlob("projects/project-a/raw/source-1/source", 2),
        FakeBlob("projects/project-a/raw/source-1/source", 1),
    )
    client = FakeStorageClient(blobs)
    cleaner = GcsProjectArtifactCleaner(
        settings=ProjectArtifactCleanupSettings(bucket_name="qali-artifacts"),
        client=client,
    )

    result = await cleaner.delete_project("project-a")

    assert result.project_id == "project-a"
    assert result.deleted_generations == 3
    assert client.list_calls == [
        {
            "bucket_name": "qali-artifacts",
            "prefix": "projects/project-a/",
            "versions": True,
            "timeout": 60,
        }
    ]
    assert [blob.name for blob in result.deleted] == [
        "projects/project-a/raw/source-1/source",
        "projects/project-a/raw/source-1/source",
        "projects/project-a/runs/run-2/result.json",
    ]
    assert [blob.generation for blob in result.deleted] == [1, 2, 4]
    assert all(
        blob.deletes == [{"if_generation_match": blob.generation, "timeout": 60}]
        for blob in blobs
    )


@pytest.mark.asyncio
async def test_project_cleanup_rejects_a_mixed_scope_before_any_delete() -> None:
    blobs = (
        FakeBlob("projects/project-a/raw/source-1/source", 1),
        FakeBlob("projects/project-b/raw/source-2/source", 1),
    )
    cleaner = GcsProjectArtifactCleaner(
        settings=ProjectArtifactCleanupSettings(bucket_name="qali-artifacts"),
        client=FakeStorageClient(blobs),
    )

    with pytest.raises(ProjectArtifactCleanupIntegrityError):
        await cleaner.delete_project("project-a")

    assert all(blob.deletes == [] for blob in blobs)


@pytest.mark.asyncio
async def test_project_cleanup_is_retry_safe_when_a_generation_is_already_gone() -> (
    None
):
    blobs = (
        FakeBlob("projects/project-a/raw/source-1/source", 1, missing=True),
        FakeBlob("projects/project-a/raw/source-1/source", 2),
    )
    cleaner = GcsProjectArtifactCleaner(
        settings=ProjectArtifactCleanupSettings(bucket_name="qali-artifacts"),
        client=FakeStorageClient(blobs),
    )

    result = await cleaner.delete_project("project-a")

    assert result.deleted_generations == 1
    assert result.already_absent_generations == 1
    assert [(item.name, item.generation) for item in result.already_absent] == [
        ("projects/project-a/raw/source-1/source", 1)
    ]


@pytest.mark.asyncio
async def test_mock_cleanup_preserves_other_projects_and_is_idempotent() -> None:
    cleaner = InMemoryProjectArtifactCleaner(
        artifacts=(
            DeletedArtifactVersion(
                name="projects/project-a/knowledge/index.md", generation=1
            ),
            DeletedArtifactVersion(
                name="projects/project-b/knowledge/index.md", generation=1
            ),
        )
    )

    first = await cleaner.delete_project("project-a")
    second = await cleaner.delete_project("project-a")

    assert first.deleted_generations == 1
    assert second.deleted_generations == 0
    assert cleaner.artifacts == (
        DeletedArtifactVersion(
            name="projects/project-b/knowledge/index.md", generation=1
        ),
    )


@pytest.mark.asyncio
async def test_project_cleanup_fails_before_mutation_when_batch_limit_is_exceeded() -> (
    None
):
    blobs = (
        FakeBlob("projects/project-a/raw/source-1/source", 1),
        FakeBlob("projects/project-a/raw/source-2/source", 1),
    )
    cleaner = GcsProjectArtifactCleaner(
        settings=ProjectArtifactCleanupSettings(
            bucket_name="qali-artifacts", max_versions_per_cleanup=1
        ),
        client=FakeStorageClient(blobs),
    )

    with pytest.raises(ProjectArtifactCleanupLimitExceeded):
        await cleaner.delete_project("project-a")

    assert all(blob.deletes == [] for blob in blobs)


@pytest.mark.asyncio
async def test_project_cleanup_rejects_invalid_generation_before_any_delete() -> None:
    blobs = (
        FakeBlob("projects/project-a/raw/source-1/source", 1),
        FakeBlob("projects/project-a/raw/source-2/source", -1),
    )
    cleaner = GcsProjectArtifactCleaner(
        settings=ProjectArtifactCleanupSettings(bucket_name="qali-artifacts"),
        client=FakeStorageClient(blobs),
    )

    with pytest.raises(ProjectArtifactCleanupIntegrityError):
        await cleaner.delete_project("project-a")

    assert all(blob.deletes == [] for blob in blobs)


def test_cleanup_guide_keeps_partial_project_deletion_explicit() -> None:
    readme = " ".join(Path("README.md").read_text().split())

    assert "all live and noncurrent GCS generations" in readme
    assert "generation-matched deletes" in readme
    assert "seven-day soft-delete recovery window" in readme
    assert "does not yet delete Firestore metadata" in readme
