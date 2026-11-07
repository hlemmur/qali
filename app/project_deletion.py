from __future__ import annotations

from datetime import datetime
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.project_artifact_cleanup import ProjectArtifactCleanupResult
from app.project_metadata_cleanup import (
    ProjectMetadataCleanupRequest,
    ProjectMetadataCleanupResult,
)


class ProjectArtifactCleaner(Protocol):
    async def delete_project(self, project_id: str) -> ProjectArtifactCleanupResult: ...


class ProjectMetadataCleaner(Protocol):
    async def delete_project(
        self, request: ProjectMetadataCleanupRequest
    ) -> ProjectMetadataCleanupResult: ...


class ProjectDeletionIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project deletion adapter returned a mismatched scope")


class ProjectDeletionResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    deletion_id: str
    project_id: str
    deleted_artifact_generations: int = Field(ge=0)
    already_absent_artifact_generations: int = Field(ge=0)
    deleted_metadata_documents: int = Field(ge=0)
    audit_expires_at: datetime


class ProjectDeletionService:
    def __init__(
        self,
        *,
        artifact_cleaner: ProjectArtifactCleaner,
        metadata_cleaner: ProjectMetadataCleaner,
    ) -> None:
        self._artifact_cleaner = artifact_cleaner
        self._metadata_cleaner = metadata_cleaner

    async def delete_project(
        self, request: ProjectMetadataCleanupRequest
    ) -> ProjectDeletionResult:
        artifacts = await self._artifact_cleaner.delete_project(request.project_id)
        if artifacts.project_id != request.project_id:
            raise ProjectDeletionIntegrityError
        metadata = await self._metadata_cleaner.delete_project(request)
        if (
            metadata.deletion_id != request.deletion_id
            or metadata.project_id != request.project_id
        ):
            raise ProjectDeletionIntegrityError
        return ProjectDeletionResult(
            deletion_id=request.deletion_id,
            project_id=request.project_id,
            deleted_artifact_generations=artifacts.deleted_generations,
            already_absent_artifact_generations=artifacts.already_absent_generations,
            deleted_metadata_documents=metadata.deleted_documents,
            audit_expires_at=metadata.audit_expires_at,
        )


__all__ = [
    "ProjectDeletionIntegrityError",
    "ProjectDeletionResult",
    "ProjectDeletionService",
]
