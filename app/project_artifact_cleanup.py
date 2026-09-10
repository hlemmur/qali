from __future__ import annotations

import asyncio
import re
from collections.abc import Iterable
from itertools import islice
from typing import Any, Protocol

from google.api_core.exceptions import NotFound
from pydantic import BaseModel, ConfigDict, Field

_PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class ProjectArtifactCleanupSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    bucket_name: str = Field(min_length=1)
    timeout_seconds: int = Field(default=60, ge=1, le=300)
    max_versions_per_cleanup: int = Field(default=1_000, ge=1, le=10_000)


class DeletedArtifactVersion(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = Field(min_length=1)
    generation: int = Field(ge=1)


class ProjectArtifactCleanupResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    deleted: tuple[DeletedArtifactVersion, ...]
    already_absent: tuple[DeletedArtifactVersion, ...]

    @property
    def deleted_generations(self) -> int:
        return len(self.deleted)

    @property
    def already_absent_generations(self) -> int:
        return len(self.already_absent)


class CleanupBlob(Protocol):
    name: str
    generation: int | None

    def delete(self, **kwargs: Any) -> None: ...


class CleanupStorageClient(Protocol):
    def list_blobs(
        self,
        bucket_name: str,
        *,
        prefix: str,
        versions: bool,
        timeout: int,
    ) -> Iterable[CleanupBlob]: ...


class ProjectArtifactCleanupIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project artifact cleanup listing failed integrity checks")


class ProjectArtifactCleanupLimitExceeded(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project artifact cleanup operation limit exceeded")


class InMemoryProjectArtifactCleaner:
    def __init__(
        self,
        *,
        artifacts: Iterable[DeletedArtifactVersion] = (),
    ) -> None:
        self._artifacts = {
            (artifact.name, artifact.generation): artifact for artifact in artifacts
        }
        self._lock = asyncio.Lock()

    @property
    def artifacts(self) -> tuple[DeletedArtifactVersion, ...]:
        return tuple(
            self._artifacts[key]
            for key in sorted(self._artifacts, key=lambda item: (item[0], item[1]))
        )

    async def delete_project(self, project_id: str) -> ProjectArtifactCleanupResult:
        prefix = _project_prefix(project_id)
        async with self._lock:
            selected = tuple(
                artifact
                for artifact in self.artifacts
                if artifact.name.startswith(prefix)
            )
            for artifact in selected:
                self._artifacts.pop((artifact.name, artifact.generation))
        return ProjectArtifactCleanupResult(
            project_id=project_id,
            deleted=selected,
            already_absent=(),
        )


class GcsProjectArtifactCleaner:
    def __init__(
        self,
        *,
        settings: ProjectArtifactCleanupSettings,
        client: CleanupStorageClient,
    ) -> None:
        self._settings = settings
        self._client = client

    async def delete_project(self, project_id: str) -> ProjectArtifactCleanupResult:
        prefix = _project_prefix(project_id)
        blobs = await asyncio.to_thread(
            lambda: tuple(
                islice(
                    self._client.list_blobs(
                        self._settings.bucket_name,
                        prefix=prefix,
                        versions=True,
                        timeout=self._settings.timeout_seconds,
                    ),
                    self._settings.max_versions_per_cleanup + 1,
                )
            )
        )
        if len(blobs) > self._settings.max_versions_per_cleanup:
            raise ProjectArtifactCleanupLimitExceeded
        if any(
            not blob.name.startswith(prefix)
            or not isinstance(blob.generation, int)
            or isinstance(blob.generation, bool)
            or blob.generation < 1
            for blob in blobs
        ):
            raise ProjectArtifactCleanupIntegrityError
        planned = tuple(
            sorted(
                (
                    (
                        blob,
                        DeletedArtifactVersion(
                            name=blob.name,
                            generation=int(blob.generation or 0),
                        ),
                    )
                    for blob in blobs
                ),
                key=lambda item: (item[1].name, item[1].generation),
            )
        )
        deleted: list[DeletedArtifactVersion] = []
        already_absent: list[DeletedArtifactVersion] = []
        for blob, version in planned:
            try:
                await asyncio.to_thread(
                    blob.delete,
                    if_generation_match=version.generation,
                    timeout=self._settings.timeout_seconds,
                )
            except NotFound:
                already_absent.append(version)
                continue
            deleted.append(version)
        return ProjectArtifactCleanupResult(
            project_id=project_id,
            deleted=tuple(deleted),
            already_absent=tuple(already_absent),
        )


def create_gcs_project_artifact_cleaner(
    settings: ProjectArtifactCleanupSettings,
) -> GcsProjectArtifactCleaner:
    from google.cloud import storage

    return GcsProjectArtifactCleaner(settings=settings, client=storage.Client())


def _project_prefix(project_id: str) -> str:
    if _PROJECT_ID.fullmatch(project_id) is None:
        raise ValueError("project_id is not a safe resource identifier")
    return f"projects/{project_id}/"


__all__ = [
    "DeletedArtifactVersion",
    "GcsProjectArtifactCleaner",
    "InMemoryProjectArtifactCleaner",
    "ProjectArtifactCleanupIntegrityError",
    "ProjectArtifactCleanupLimitExceeded",
    "ProjectArtifactCleanupResult",
    "ProjectArtifactCleanupSettings",
    "create_gcs_project_artifact_cleaner",
]
