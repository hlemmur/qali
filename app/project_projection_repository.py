from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Protocol

from google.api_core.exceptions import NotFound, PreconditionFailed
from pydantic import BaseModel, ConfigDict, Field

from app.project_projections import ProjectProjectionBundle
from app.run_artifacts import RunArtifactDocument


class ProjectProjectionPointer(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    object_name: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    generation: int = Field(ge=1)
    updated_at: datetime


class PublishedProjectProjections(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    projections: tuple[ProjectProjectionPointer, ProjectProjectionPointer]


class ProjectProjectionWriteConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project projection generation conflict")


class GcsProjectProjectionSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    bucket_name: str = Field(min_length=1)
    timeout_seconds: int = Field(default=60, ge=1, le=300)


class ProjectProjectionBlob(Protocol):
    metadata: dict[str, str] | None
    generation: int | None

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None: ...

    def reload(self, **kwargs: Any) -> None: ...

    def download_as_bytes(self, **kwargs: Any) -> bytes: ...


class ProjectProjectionBucket(Protocol):
    def blob(self, object_name: str) -> ProjectProjectionBlob: ...


class ProjectProjectionStorageClient(Protocol):
    def bucket(self, bucket_name: str) -> ProjectProjectionBucket: ...


class InMemoryProjectProjectionRepository:
    def __init__(self, *, clock: Callable[[], datetime] | None = None) -> None:
        self._clock = clock or _utc_now
        self._documents: dict[str, RunArtifactDocument] = {}
        self._pointers: dict[str, ProjectProjectionPointer] = {}
        self._lock = asyncio.Lock()

    async def publish(
        self,
        bundle: ProjectProjectionBundle,
        *,
        expected_generations: Mapping[str, int],
    ) -> PublishedProjectProjections:
        _validate_expected_generations(bundle, expected_generations)
        updated_at = _aware_utc(self._clock())
        async with self._lock:
            has_stale_generation = any(
                expected_generations[document.object_name]
                != (
                    0
                    if (current := self._pointers.get(document.object_name)) is None
                    else current.generation
                )
                for document in bundle.documents
            )
            if has_stale_generation:
                if all(
                    self._documents.get(document.object_name) == document
                    for document in bundle.documents
                ):
                    return self._published(bundle)
                raise ProjectProjectionWriteConflict
            for document in bundle.documents:
                current = self._pointers.get(document.object_name)
                generation = 1 if current is None else current.generation + 1
                self._documents[document.object_name] = document
                self._pointers[document.object_name] = ProjectProjectionPointer(
                    object_name=document.object_name,
                    sha256=document.sha256,
                    generation=generation,
                    updated_at=updated_at,
                )
            return self._published(bundle)

    async def read(self, object_name: str) -> RunArtifactDocument:
        async with self._lock:
            return self._documents[object_name]

    async def current_generations(self, project_id: str) -> dict[str, int]:
        async with self._lock:
            return {
                object_name: (
                    0
                    if (pointer := self._pointers.get(object_name)) is None
                    else pointer.generation
                )
                for object_name in _projection_paths(project_id)
            }

    def _published(
        self,
        bundle: ProjectProjectionBundle,
    ) -> PublishedProjectProjections:
        first, second = bundle.documents
        return PublishedProjectProjections(
            project_id=bundle.project_id,
            projections=(
                self._pointers[first.object_name],
                self._pointers[second.object_name],
            ),
        )


class GcsProjectProjectionRepository:
    def __init__(
        self,
        *,
        settings: GcsProjectProjectionSettings,
        client: ProjectProjectionStorageClient,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        self._clock = clock or _utc_now

    async def publish(
        self,
        bundle: ProjectProjectionBundle,
        *,
        expected_generations: Mapping[str, int],
    ) -> PublishedProjectProjections:
        _validate_expected_generations(bundle, expected_generations)
        updated_at = _aware_utc(self._clock())
        bucket = self._client.bucket(self._settings.bucket_name)
        pointers: list[ProjectProjectionPointer] = []
        for document in bundle.documents:
            blob = bucket.blob(document.object_name)
            blob.metadata = {
                "project_id": bundle.project_id,
                "sha256": document.sha256,
                "updated_at": _rfc3339(updated_at),
            }
            try:
                await asyncio.to_thread(
                    blob.upload_from_string,
                    document.content,
                    content_type=document.content_type,
                    if_generation_match=expected_generations[document.object_name],
                    checksum="auto",
                    timeout=self._settings.timeout_seconds,
                )
            except PreconditionFailed:
                pointers.append(
                    await self._resolve_retry(
                        blob,
                        bundle=bundle,
                        document=document,
                    )
                )
                continue
            if blob.generation is None or blob.generation < 1:
                raise ProjectProjectionWriteConflict
            pointers.append(
                ProjectProjectionPointer(
                    object_name=document.object_name,
                    sha256=document.sha256,
                    generation=blob.generation,
                    updated_at=updated_at,
                )
            )
        first, second = pointers
        return PublishedProjectProjections(
            project_id=bundle.project_id,
            projections=(first, second),
        )

    async def current_generations(self, project_id: str) -> dict[str, int]:
        bucket = self._client.bucket(self._settings.bucket_name)
        generations = {}
        for object_name in _projection_paths(project_id):
            blob = bucket.blob(object_name)
            try:
                await asyncio.to_thread(
                    blob.reload,
                    timeout=self._settings.timeout_seconds,
                )
            except NotFound:
                generations[object_name] = 0
                continue
            if blob.generation is None or blob.generation < 1:
                raise ProjectProjectionWriteConflict
            generations[object_name] = int(blob.generation)
        return generations

    async def _resolve_retry(
        self,
        blob: ProjectProjectionBlob,
        *,
        bundle: ProjectProjectionBundle,
        document: RunArtifactDocument,
    ) -> ProjectProjectionPointer:
        await asyncio.to_thread(blob.reload, timeout=self._settings.timeout_seconds)
        metadata = blob.metadata or {}
        if (
            metadata.get("project_id") != bundle.project_id
            or metadata.get("sha256") != document.sha256
        ):
            raise ProjectProjectionWriteConflict from None
        existing = await asyncio.to_thread(
            blob.download_as_bytes,
            checksum="auto",
            timeout=self._settings.timeout_seconds,
        )
        if existing != document.content:
            raise ProjectProjectionWriteConflict from None
        try:
            generation = int(blob.generation or 0)
            updated_at = datetime.fromisoformat(
                metadata["updated_at"].replace("Z", "+00:00")
            )
        except (KeyError, ValueError):
            raise ProjectProjectionWriteConflict from None
        if generation < 1:
            raise ProjectProjectionWriteConflict from None
        return ProjectProjectionPointer(
            object_name=document.object_name,
            sha256=document.sha256,
            generation=generation,
            updated_at=_aware_utc(updated_at),
        )


def create_gcs_project_projection_repository(
    settings: GcsProjectProjectionSettings,
) -> GcsProjectProjectionRepository:
    from google.cloud import storage

    return GcsProjectProjectionRepository(settings=settings, client=storage.Client())


def _validate_expected_generations(
    bundle: ProjectProjectionBundle,
    expected_generations: Mapping[str, int],
) -> None:
    expected_paths = {document.object_name for document in bundle.documents}
    if set(expected_generations) != expected_paths:
        raise ValueError("expected generations must cover both project projections")
    if any(generation < 0 for generation in expected_generations.values()):
        raise ValueError("expected projection generation cannot be negative")


def _projection_paths(project_id: str) -> tuple[str, str]:
    return (
        f"projects/{project_id}/logs/testing-log.md",
        f"projects/{project_id}/issues/index.md",
    )


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("projection clock must return a timezone-aware datetime")
    return value.astimezone(UTC)


def _rfc3339(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _utc_now() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "GcsProjectProjectionRepository",
    "GcsProjectProjectionSettings",
    "InMemoryProjectProjectionRepository",
    "ProjectProjectionPointer",
    "ProjectProjectionWriteConflict",
    "PublishedProjectProjections",
    "create_gcs_project_projection_repository",
]
