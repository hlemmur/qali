from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from google.api_core.exceptions import NotFound, PreconditionFailed

from app.project_projection_repository import (
    GcsProjectProjectionRepository,
    GcsProjectProjectionSettings,
    InMemoryProjectProjectionRepository,
    ProjectProjectionWriteConflict,
)
from app.project_projections import (
    FindingProjectionState,
    FindingStatus,
    ProjectRunAuditEvent,
    compile_project_projections,
)
from tests.integration.test_run_artifacts import _failed_run


class _VersionedBlob:
    def __init__(self) -> None:
        self.metadata: dict[str, str] | None = None
        self.stored_metadata: dict[str, str] | None = None
        self.stored_data: bytes | None = None
        self.generation: int | None = None
        self.uploads: list[dict[str, Any]] = []

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None:
        self.uploads.append({"data": data, **kwargs})
        current_generation = self.generation or 0
        if kwargs["if_generation_match"] != current_generation:
            raise PreconditionFailed("generation precondition failed")
        self.generation = current_generation + 1
        self.stored_data = data
        self.stored_metadata = None if self.metadata is None else self.metadata.copy()

    def reload(self, **kwargs: Any) -> None:
        del kwargs
        if self.generation is None:
            raise NotFound("projection does not exist")
        self.metadata = (
            None if self.stored_metadata is None else self.stored_metadata.copy()
        )

    def download_as_bytes(self, **kwargs: Any) -> bytes:
        del kwargs
        assert self.stored_data is not None
        return self.stored_data


class _Bucket:
    def __init__(self) -> None:
        self.blobs: dict[str, _VersionedBlob] = {}

    def blob(self, object_name: str) -> _VersionedBlob:
        return self.blobs.setdefault(object_name, _VersionedBlob())


class _StorageClient:
    def __init__(self) -> None:
        self.bucket_names: list[str] = []
        self.bucket_reference = _Bucket()

    def bucket(self, bucket_name: str) -> _Bucket:
        self.bucket_names.append(bucket_name)
        return self.bucket_reference


@pytest.mark.asyncio
async def test_mock_repository_publishes_and_reads_both_project_projections() -> None:
    record = await _failed_run()
    bundle = compile_project_projections(
        (
            ProjectRunAuditEvent(
                record=record,
                completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
            ),
        )
    )
    repository = InMemoryProjectProjectionRepository(
        clock=lambda: datetime(2026, 9, 8, 10, 1, tzinfo=UTC)
    )

    published = await repository.publish(
        bundle,
        expected_generations={document.object_name: 0 for document in bundle.documents},
    )

    assert await repository.current_generations("project-alpha") == {
        "projects/project-alpha/logs/testing-log.md": 1,
        "projects/project-alpha/issues/index.md": 1,
    }

    assert published.project_id == "project-alpha"
    assert tuple(pointer.generation for pointer in published.projections) == (1, 1)
    assert tuple(pointer.object_name for pointer in published.projections) == tuple(
        document.object_name for document in bundle.documents
    )
    for document in bundle.documents:
        assert await repository.read(document.object_name) == document


@pytest.mark.asyncio
async def test_mock_repository_replaces_both_projections_atomically() -> None:
    record = await _failed_run()
    finding = record.investigations[0].finding
    assert finding is not None
    event = ProjectRunAuditEvent(
        record=record,
        completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
    )
    original = compile_project_projections((event,))
    changed = compile_project_projections(
        (event,),
        finding_states=(
            FindingProjectionState(
                finding_id=finding.finding_id,
                status=FindingStatus.RESOLVED,
            ),
        ),
    )
    repository = InMemoryProjectProjectionRepository()
    initial = {document.object_name: 0 for document in original.documents}
    first = await repository.publish(original, expected_generations=initial)
    current = {pointer.object_name: pointer.generation for pointer in first.projections}

    updated = await repository.publish(changed, expected_generations=current)

    assert tuple(pointer.generation for pointer in updated.projections) == (2, 2)
    with pytest.raises(ProjectProjectionWriteConflict):
        await repository.publish(original, expected_generations=current)
    for document in changed.documents:
        assert await repository.read(document.object_name) == document


@pytest.mark.asyncio
async def test_mock_repository_reuses_identical_stale_retry() -> None:
    record = await _failed_run()
    bundle = compile_project_projections(
        (
            ProjectRunAuditEvent(
                record=record,
                completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
            ),
        )
    )
    repository = InMemoryProjectProjectionRepository()
    expected = {document.object_name: 0 for document in bundle.documents}

    first = await repository.publish(bundle, expected_generations=expected)
    retry = await repository.publish(bundle, expected_generations=expected)

    assert retry == first


@pytest.mark.asyncio
async def test_gcs_repository_publishes_each_projection_with_generation_guards() -> (
    None
):
    record = await _failed_run()
    bundle = compile_project_projections(
        (
            ProjectRunAuditEvent(
                record=record,
                completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
            ),
        )
    )
    client = _StorageClient()
    repository = GcsProjectProjectionRepository(
        settings=GcsProjectProjectionSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: datetime(2026, 9, 8, 10, 1, tzinfo=UTC),
    )

    assert await repository.current_generations("project-alpha") == {
        "projects/project-alpha/logs/testing-log.md": 0,
        "projects/project-alpha/issues/index.md": 0,
    }

    published = await repository.publish(
        bundle,
        expected_generations={document.object_name: 0 for document in bundle.documents},
    )

    assert await repository.current_generations("project-alpha") == {
        "projects/project-alpha/logs/testing-log.md": 1,
        "projects/project-alpha/issues/index.md": 1,
    }

    assert tuple(pointer.generation for pointer in published.projections) == (1, 1)
    assert client.bucket_names == ["qali-private-artifacts"] * 3
    for document in bundle.documents:
        blob = client.bucket_reference.blobs[document.object_name]
        assert blob.stored_data == document.content
        assert blob.uploads == [
            {
                "data": document.content,
                "content_type": "text/markdown; charset=utf-8",
                "if_generation_match": 0,
                "checksum": "auto",
                "timeout": 60,
            }
        ]
        assert blob.stored_metadata == {
            "project_id": "project-alpha",
            "sha256": document.sha256,
            "updated_at": "2026-09-08T10:01:00Z",
        }


@pytest.mark.asyncio
async def test_gcs_repository_reuses_an_identical_stale_retry() -> None:
    record = await _failed_run()
    bundle = compile_project_projections(
        (
            ProjectRunAuditEvent(
                record=record,
                completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
            ),
        )
    )
    client = _StorageClient()
    timestamps = iter(
        (
            datetime(2026, 9, 8, 10, 1, tzinfo=UTC),
            datetime(2026, 9, 8, 10, 2, tzinfo=UTC),
        )
    )
    repository = GcsProjectProjectionRepository(
        settings=GcsProjectProjectionSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: next(timestamps),
    )
    expected = {document.object_name: 0 for document in bundle.documents}

    first = await repository.publish(bundle, expected_generations=expected)
    retry = await repository.publish(bundle, expected_generations=expected)

    assert retry == first
    assert tuple(
        len(client.bucket_reference.blobs[document.object_name].uploads)
        for document in bundle.documents
    ) == (2, 2)


@pytest.mark.asyncio
async def test_gcs_repository_rejects_stale_changed_projection_content() -> None:
    record = await _failed_run()
    finding = record.investigations[0].finding
    assert finding is not None
    event = ProjectRunAuditEvent(
        record=record,
        completed_at=datetime(2026, 9, 8, 10, 0, tzinfo=UTC),
    )
    original = compile_project_projections((event,))
    changed = compile_project_projections(
        (event,),
        finding_states=(
            FindingProjectionState(
                finding_id=finding.finding_id,
                status=FindingStatus.RESOLVED,
            ),
        ),
    )
    client = _StorageClient()
    repository = GcsProjectProjectionRepository(
        settings=GcsProjectProjectionSettings(bucket_name="qali-private-artifacts"),
        client=client,
    )
    initial = {document.object_name: 0 for document in original.documents}
    first = await repository.publish(original, expected_generations=initial)
    current = {pointer.object_name: pointer.generation for pointer in first.projections}
    updated = await repository.publish(changed, expected_generations=current)

    with pytest.raises(ProjectProjectionWriteConflict):
        await repository.publish(original, expected_generations=current)

    assert tuple(pointer.generation for pointer in updated.projections) == (2, 2)
    for document in changed.documents:
        assert client.bucket_reference.blobs[document.object_name].stored_data == (
            document.content
        )
