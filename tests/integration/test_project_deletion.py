from datetime import UTC, datetime

import pytest

from app.project_artifact_cleanup import (
    DeletedArtifactVersion,
    InMemoryProjectArtifactCleaner,
    ProjectArtifactCleanupResult,
)
from app.project_deletion import ProjectDeletionIntegrityError, ProjectDeletionService
from app.project_identity import project_id_for_channel
from app.project_metadata_cleanup import (
    InMemoryProjectMetadataCleaner,
    InMemoryProjectMetadataDocument,
    ProjectMetadataCleanupRequest,
    ProjectMetadataCleanupResult,
)


class RecordingArtifactCleaner:
    def __init__(self, calls: list[str]) -> None:
        self._calls = calls

    async def delete_project(self, project_id: str) -> ProjectArtifactCleanupResult:
        self._calls.append("artifacts")
        return ProjectArtifactCleanupResult(
            project_id=project_id,
            deleted=(
                DeletedArtifactVersion(
                    name=f"projects/{project_id}/knowledge/index.md",
                    generation=1,
                ),
            ),
            already_absent=(),
        )


class RecordingMetadataCleaner:
    def __init__(self, calls: list[str]) -> None:
        self._calls = calls

    async def delete_project(
        self, request: ProjectMetadataCleanupRequest
    ) -> ProjectMetadataCleanupResult:
        self._calls.append("metadata")
        return ProjectMetadataCleanupResult(
            deletion_id=request.deletion_id,
            project_id=request.project_id,
            deleted_documents=4,
            audit_expires_at=datetime(2026, 12, 10, tzinfo=UTC),
        )


class MismatchedArtifactCleaner:
    async def delete_project(self, project_id: str) -> ProjectArtifactCleanupResult:
        return ProjectArtifactCleanupResult(
            project_id="another-project", deleted=(), already_absent=()
        )


class MismatchedMetadataCleaner:
    async def delete_project(
        self, request: ProjectMetadataCleanupRequest
    ) -> ProjectMetadataCleanupResult:
        return ProjectMetadataCleanupResult(
            deletion_id="another-deletion",
            project_id=request.project_id,
            deleted_documents=0,
            audit_expires_at=datetime(2026, 12, 10, tzinfo=UTC),
        )


class FailingArtifactCleaner:
    async def delete_project(self, project_id: str) -> ProjectArtifactCleanupResult:
        raise RuntimeError("artifact cleanup failed")


@pytest.mark.asyncio
async def test_project_deletion_removes_artifacts_before_finalizing_metadata() -> None:
    calls: list[str] = []
    service = ProjectDeletionService(
        artifact_cleaner=RecordingArtifactCleaner(calls),
        metadata_cleaner=RecordingMetadataCleaner(calls),
    )
    workspace_id = "T123"
    channel_id = "C123"
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-complete",
        project_id=project_id_for_channel(workspace_id, channel_id),
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="a" * 64,
    )

    result = await service.delete_project(request)

    assert calls == ["artifacts", "metadata"]
    assert result.deletion_id == request.deletion_id
    assert result.project_id == request.project_id
    assert result.deleted_artifact_generations == 1
    assert result.already_absent_artifact_generations == 0
    assert result.deleted_metadata_documents == 4
    assert result.audit_expires_at == datetime(2026, 12, 10, tzinfo=UTC)


@pytest.mark.asyncio
async def test_project_deletion_rejects_mismatched_artifact_scope_before_metadata() -> (
    None
):
    calls: list[str] = []
    service = ProjectDeletionService(
        artifact_cleaner=MismatchedArtifactCleaner(),
        metadata_cleaner=RecordingMetadataCleaner(calls),
    )
    workspace_id = "T123"
    channel_id = "C123"
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-mismatch",
        project_id=project_id_for_channel(workspace_id, channel_id),
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="b" * 64,
    )

    with pytest.raises(ProjectDeletionIntegrityError):
        await service.delete_project(request)

    assert calls == []


@pytest.mark.asyncio
async def test_project_deletion_rejects_mismatched_metadata_evidence() -> None:
    calls: list[str] = []
    service = ProjectDeletionService(
        artifact_cleaner=RecordingArtifactCleaner(calls),
        metadata_cleaner=MismatchedMetadataCleaner(),
    )
    workspace_id = "T123"
    channel_id = "C123"
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-metadata-mismatch",
        project_id=project_id_for_channel(workspace_id, channel_id),
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="d" * 64,
    )

    with pytest.raises(ProjectDeletionIntegrityError):
        await service.delete_project(request)


@pytest.mark.asyncio
async def test_project_deletion_does_not_remove_metadata_after_artifact_failure() -> (
    None
):
    metadata_calls: list[str] = []
    service = ProjectDeletionService(
        artifact_cleaner=FailingArtifactCleaner(),
        metadata_cleaner=RecordingMetadataCleaner(metadata_calls),
    )
    workspace_id = "T123"
    channel_id = "C123"
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-artifact-failure",
        project_id=project_id_for_channel(workspace_id, channel_id),
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="f" * 64,
    )

    with pytest.raises(RuntimeError, match="artifact cleanup failed"):
        await service.delete_project(request)

    assert metadata_calls == []


@pytest.mark.asyncio
async def test_mock_project_deletion_preserves_other_projects_and_is_retry_safe() -> (
    None
):
    workspace_id = "T123"
    channel_id = "C123"
    project_id = project_id_for_channel(workspace_id, channel_id)
    artifact_cleaner = InMemoryProjectArtifactCleaner(
        artifacts=(
            DeletedArtifactVersion(
                name=f"projects/{project_id}/knowledge/index.md", generation=1
            ),
            DeletedArtifactVersion(
                name="projects/other-project/knowledge/index.md", generation=1
            ),
        )
    )
    metadata_cleaner = InMemoryProjectMetadataCleaner(
        documents=(
            InMemoryProjectMetadataDocument(
                collection="projects",
                document_id="target",
                data={"project_id": project_id},
            ),
            InMemoryProjectMetadataDocument(
                collection="projects",
                document_id="other",
                data={"project_id": "other-project"},
            ),
        ),
        clock=lambda: datetime(2026, 9, 11, 8, 0, tzinfo=UTC),
    )
    service = ProjectDeletionService(
        artifact_cleaner=artifact_cleaner,
        metadata_cleaner=metadata_cleaner,
    )
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-mock-complete",
        project_id=project_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="c" * 64,
    )

    first = await service.delete_project(request)
    second = await service.delete_project(request)

    assert first.deleted_artifact_generations == 1
    assert first.deleted_metadata_documents == 1
    assert second.deleted_artifact_generations == 0
    assert second.deleted_metadata_documents == 1
    assert [artifact.name for artifact in artifact_cleaner.artifacts] == [
        "projects/other-project/knowledge/index.md"
    ]
    assert [document.document_id for document in metadata_cleaner.documents] == [
        "other"
    ]
