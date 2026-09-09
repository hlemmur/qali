from __future__ import annotations

import asyncio
import hashlib
import re
from typing import Any, Protocol

from google.api_core.exceptions import PreconditionFailed
from pydantic import BaseModel, ConfigDict, Field

from app.feature_context_loader import (
    FeatureContextUnavailable,
    FeatureProjectContext,
)
from app.knowledge_quality import KnowledgeReadiness

_PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class GcsFeatureContextSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    bucket_name: str = Field(min_length=1)
    timeout_seconds: int = Field(default=60, ge=1, le=300)


class FeatureContextPointer(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    object_name: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    generation: int = Field(ge=1)


class FeatureContextBlob(Protocol):
    metadata: dict[str, str] | None
    generation: int | None

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None: ...

    def reload(self, **kwargs: Any) -> None: ...

    def download_as_bytes(self, **kwargs: Any) -> bytes: ...


class FeatureContextBucket(Protocol):
    def blob(self, object_name: str) -> FeatureContextBlob: ...


class FeatureContextStorageClient(Protocol):
    def bucket(self, bucket_name: str) -> FeatureContextBucket: ...


class FeatureContextWriteConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("approved feature context generation conflict")


class GcsFeatureContextRepository:
    def __init__(
        self,
        *,
        settings: GcsFeatureContextSettings,
        client: FeatureContextStorageClient,
    ) -> None:
        self._settings = settings
        self._client = client

    async def publish(
        self,
        context: FeatureProjectContext,
        *,
        expected_generation: int,
    ) -> FeatureContextPointer:
        if expected_generation < 0:
            raise ValueError("expected feature context generation cannot be negative")
        if context.readiness is not KnowledgeReadiness.READY:
            raise ValueError("approved feature context must be ready")
        object_name = _object_name(context.project_id)
        content = context.model_dump_json().encode()
        digest = hashlib.sha256(content).hexdigest()
        blob = self._client.bucket(self._settings.bucket_name).blob(object_name)
        blob.metadata = {"project_id": context.project_id, "sha256": digest}
        try:
            await asyncio.to_thread(
                blob.upload_from_string,
                content,
                content_type="application/json",
                if_generation_match=expected_generation,
                checksum="auto",
                timeout=self._settings.timeout_seconds,
            )
        except PreconditionFailed:
            return await self._resolve_retry(
                blob,
                project_id=context.project_id,
                object_name=object_name,
                content=content,
                digest=digest,
            )
        if blob.generation is None or blob.generation < 1:
            raise FeatureContextUnavailable("approved feature context is unavailable")
        return FeatureContextPointer(
            object_name=object_name,
            sha256=digest,
            generation=blob.generation,
        )

    async def _resolve_retry(
        self,
        blob: FeatureContextBlob,
        *,
        project_id: str,
        object_name: str,
        content: bytes,
        digest: str,
    ) -> FeatureContextPointer:
        await asyncio.to_thread(
            blob.reload,
            timeout=self._settings.timeout_seconds,
        )
        metadata = blob.metadata or {}
        existing = await asyncio.to_thread(
            blob.download_as_bytes,
            checksum="auto",
            timeout=self._settings.timeout_seconds,
        )
        if (
            metadata.get("project_id") != project_id
            or metadata.get("sha256") != digest
            or existing != content
            or blob.generation is None
            or blob.generation < 1
        ):
            raise FeatureContextWriteConflict from None
        return FeatureContextPointer(
            object_name=object_name,
            sha256=digest,
            generation=blob.generation,
        )

    async def load(self, project_id: str) -> FeatureProjectContext:
        try:
            object_name = _object_name(project_id)
            blob = self._client.bucket(self._settings.bucket_name).blob(object_name)
            await asyncio.to_thread(
                blob.reload,
                timeout=self._settings.timeout_seconds,
            )
            metadata = blob.metadata or {}
            content = await asyncio.to_thread(
                blob.download_as_bytes,
                checksum="auto",
                timeout=self._settings.timeout_seconds,
            )
            digest = hashlib.sha256(content).hexdigest()
            if (
                metadata.get("project_id") != project_id
                or metadata.get("sha256") != digest
                or blob.generation is None
                or blob.generation < 1
            ):
                raise ValueError("invalid feature context metadata")
            context = FeatureProjectContext.model_validate_json(content)
            if context.project_id != project_id:
                raise ValueError("feature context project does not match")
            return context
        except Exception:
            raise FeatureContextUnavailable(
                "approved feature context is unavailable"
            ) from None


def create_gcs_feature_context_repository(
    settings: GcsFeatureContextSettings,
) -> GcsFeatureContextRepository:
    from google.cloud import storage

    return GcsFeatureContextRepository(settings=settings, client=storage.Client())


def _object_name(project_id: str) -> str:
    if _PROJECT_ID.fullmatch(project_id) is None:
        raise ValueError("project_id is not a safe resource identifier")
    return f"projects/{project_id}/context/feature.json"


__all__ = [
    "FeatureContextPointer",
    "FeatureContextWriteConflict",
    "GcsFeatureContextRepository",
    "GcsFeatureContextSettings",
    "create_gcs_feature_context_repository",
]
