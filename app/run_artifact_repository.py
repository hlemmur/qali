from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

from google.api_core.exceptions import PreconditionFailed
from pydantic import BaseModel, ConfigDict, Field

from app.run_artifacts import (
    BrowserEvidenceArtifactBundle,
    FeatureRunArtifactBundle,
    RunArtifactDocument,
)

ArtifactBundle = FeatureRunArtifactBundle | BrowserEvidenceArtifactBundle


class GcsRunArtifactSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    bucket_name: str = Field(min_length=1)
    timeout_seconds: int = Field(default=60, ge=1, le=300)


class RunArtifactPointer(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    object_name: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    generation: int = Field(ge=1)
    created_at: datetime


class PublishedRunArtifacts(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    run_id: str
    artifacts: tuple[RunArtifactPointer, ...] = Field(min_length=4, max_length=104)


class RunArtifactBlob(Protocol):
    metadata: dict[str, str] | None
    generation: int | None
    content_type: str | None

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None: ...

    def reload(self, **kwargs: Any) -> None: ...

    def download_as_bytes(self, **kwargs: Any) -> bytes: ...


class RunArtifactBucket(Protocol):
    def blob(self, object_name: str) -> RunArtifactBlob: ...


class RunArtifactStorageClient(Protocol):
    def bucket(self, bucket_name: str) -> RunArtifactBucket: ...


class RunArtifactWriteConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("immutable run artifact already contains different content")


class InMemoryRunArtifactRepository:
    def __init__(self, *, clock: Callable[[], datetime] | None = None) -> None:
        self._clock = clock or _utc_now
        self._documents: dict[str, RunArtifactDocument] = {}
        self._pointers: dict[str, RunArtifactPointer] = {}
        self._scope_by_object: dict[str, tuple[str, str]] = {}
        self._lock = asyncio.Lock()

    async def publish(
        self,
        bundle: ArtifactBundle,
    ) -> PublishedRunArtifacts:
        created_at = _aware_utc(self._clock())
        async with self._lock:
            for document in bundle.documents:
                existing = self._documents.get(document.object_name)
                if existing is not None and existing != document:
                    raise RunArtifactWriteConflict
            for document in bundle.documents:
                if document.object_name not in self._documents:
                    self._documents[document.object_name] = document
                    self._pointers[document.object_name] = RunArtifactPointer(
                        object_name=document.object_name,
                        sha256=document.sha256,
                        generation=1,
                        created_at=created_at,
                    )
                    self._scope_by_object[document.object_name] = (
                        bundle.project_id,
                        bundle.run_id,
                    )
            return PublishedRunArtifacts(
                project_id=bundle.project_id,
                run_id=bundle.run_id,
                artifacts=tuple(
                    self._pointers[document.object_name]
                    for document in bundle.documents
                ),
            )

    async def read(self, object_name: str) -> RunArtifactDocument:
        async with self._lock:
            return self._documents[object_name]

    async def resolve_finding_run(self, project_id: str, finding_id: str) -> str:
        object_name = f"projects/{project_id}/issues/{finding_id}.md"
        async with self._lock:
            stored_project_id, run_id = self._scope_by_object[object_name]
            if stored_project_id != project_id:
                raise KeyError(finding_id)
            return run_id


class GcsRunArtifactRepository:
    def __init__(
        self,
        *,
        settings: GcsRunArtifactSettings,
        client: RunArtifactStorageClient,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        self._clock = clock or _utc_now

    async def publish(
        self,
        bundle: ArtifactBundle,
    ) -> PublishedRunArtifacts:
        created_at = _aware_utc(self._clock())
        bucket = self._client.bucket(self._settings.bucket_name)
        pointers = []
        for document in bundle.documents:
            blob = bucket.blob(document.object_name)
            blob.metadata = {
                "sha256": document.sha256,
                "project_id": bundle.project_id,
                "run_id": bundle.run_id,
                "created_at": _rfc3339(created_at),
            }
            try:
                await asyncio.to_thread(
                    blob.upload_from_string,
                    document.content,
                    content_type=document.content_type,
                    if_generation_match=0,
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
                raise RunArtifactWriteConflict
            pointers.append(
                RunArtifactPointer(
                    object_name=document.object_name,
                    sha256=document.sha256,
                    generation=blob.generation,
                    created_at=created_at,
                )
            )
        return PublishedRunArtifacts(
            project_id=bundle.project_id,
            run_id=bundle.run_id,
            artifacts=tuple(pointers),
        )

    async def read(self, object_name: str) -> RunArtifactDocument:
        blob = self._client.bucket(self._settings.bucket_name).blob(object_name)
        await asyncio.to_thread(blob.reload, timeout=self._settings.timeout_seconds)
        metadata = blob.metadata or {}
        content_type = blob.content_type
        expected_hash = metadata.get("sha256")
        if content_type is None or expected_hash is None:
            raise RunArtifactWriteConflict
        content = await asyncio.to_thread(
            blob.download_as_bytes,
            checksum="auto",
            timeout=self._settings.timeout_seconds,
        )
        try:
            return RunArtifactDocument(
                object_name=object_name,
                content_type=content_type,
                content=content,
                sha256=expected_hash,
            )
        except ValueError:
            raise RunArtifactWriteConflict from None

    async def resolve_finding_run(self, project_id: str, finding_id: str) -> str:
        object_name = f"projects/{project_id}/issues/{finding_id}.md"
        blob = self._client.bucket(self._settings.bucket_name).blob(object_name)
        await asyncio.to_thread(blob.reload, timeout=self._settings.timeout_seconds)
        metadata = blob.metadata or {}
        if metadata.get("project_id") != project_id:
            raise KeyError(finding_id)
        run_id = metadata.get("run_id")
        if run_id is None:
            raise KeyError(finding_id)
        return run_id

    async def _resolve_retry(
        self,
        blob: RunArtifactBlob,
        *,
        bundle: FeatureRunArtifactBundle,
        document: RunArtifactDocument,
    ) -> RunArtifactPointer:
        await asyncio.to_thread(blob.reload, timeout=self._settings.timeout_seconds)
        metadata = blob.metadata or {}
        if (
            metadata.get("sha256") != document.sha256
            or metadata.get("project_id") != bundle.project_id
            or metadata.get("run_id") != bundle.run_id
        ):
            raise RunArtifactWriteConflict from None
        existing = await asyncio.to_thread(
            blob.download_as_bytes,
            checksum="auto",
            timeout=self._settings.timeout_seconds,
        )
        if existing != document.content:
            raise RunArtifactWriteConflict from None
        try:
            generation = int(blob.generation or 0)
            created_at = datetime.fromisoformat(
                metadata["created_at"].replace("Z", "+00:00")
            )
        except (KeyError, ValueError):
            raise RunArtifactWriteConflict from None
        if generation < 1:
            raise RunArtifactWriteConflict from None
        return RunArtifactPointer(
            object_name=document.object_name,
            sha256=document.sha256,
            generation=generation,
            created_at=_aware_utc(created_at),
        )


def create_gcs_run_artifact_repository(
    settings: GcsRunArtifactSettings,
) -> GcsRunArtifactRepository:
    from google.cloud import storage

    return GcsRunArtifactRepository(settings=settings, client=storage.Client())


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("run artifact clock must return a timezone-aware datetime")
    return value.astimezone(UTC)


def _rfc3339(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _utc_now() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "GcsRunArtifactRepository",
    "GcsRunArtifactSettings",
    "InMemoryRunArtifactRepository",
    "PublishedRunArtifacts",
    "RunArtifactPointer",
    "RunArtifactWriteConflict",
    "create_gcs_run_artifact_repository",
]
