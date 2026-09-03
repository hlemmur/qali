from __future__ import annotations

import asyncio
import hashlib
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

from google.api_core.exceptions import PreconditionFailed
from pydantic import BaseModel, ConfigDict, Field

from app.knowledge_markdown import CompiledKnowledgeDocument

_PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class GcsKnowledgeSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    bucket_name: str = Field(min_length=1)
    timeout_seconds: int = Field(default=60, ge=1, le=300)


class KnowledgeArtifact(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    object_name: str
    sha256: str
    generation: int = Field(ge=1)
    updated_at: datetime


class KnowledgeBlob(Protocol):
    metadata: dict[str, str] | None
    generation: int | None

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None: ...

    def reload(self, **kwargs: Any) -> None: ...

    def download_as_bytes(self, **kwargs: Any) -> bytes: ...


class KnowledgeBucket(Protocol):
    def blob(self, object_name: str) -> KnowledgeBlob: ...


class KnowledgeStorageClient(Protocol):
    def bucket(self, bucket_name: str) -> KnowledgeBucket: ...


class KnowledgeWriteConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("compiled knowledge generation conflict")


class GcsKnowledgeRepository:
    def __init__(
        self,
        *,
        settings: GcsKnowledgeSettings,
        client: KnowledgeStorageClient,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        self._clock = clock or _utc_now

    async def publish(
        self,
        document: CompiledKnowledgeDocument,
        *,
        expected_generation: int,
    ) -> KnowledgeArtifact:
        if expected_generation < 0:
            raise ValueError("expected_generation cannot be negative")
        if _PROJECT_ID.fullmatch(document.project_id) is None:
            raise ValueError("project_id is not a safe resource identifier")
        if hashlib.sha256(document.content).hexdigest() != document.sha256:
            raise ValueError("compiled knowledge content hash does not match")
        updated_at = self._clock()
        if updated_at.tzinfo is None or updated_at.utcoffset() is None:
            raise ValueError("knowledge clock must return a timezone-aware datetime")
        updated_at = updated_at.astimezone(UTC)
        object_name = f"projects/{document.project_id}/knowledge/index.md"
        blob = self._client.bucket(self._settings.bucket_name).blob(object_name)
        blob.metadata = {
            "sha256": document.sha256,
            "updated_at": updated_at.isoformat().replace("+00:00", "Z"),
        }
        try:
            await asyncio.to_thread(
                blob.upload_from_string,
                document.content,
                content_type=document.content_type,
                if_generation_match=expected_generation,
                checksum="auto",
                timeout=self._settings.timeout_seconds,
            )
        except PreconditionFailed:
            return await self._resolve_retry(blob, document, object_name)
        if blob.generation is None or blob.generation < 1:
            raise KnowledgeWriteConflict
        return KnowledgeArtifact(
            project_id=document.project_id,
            object_name=object_name,
            sha256=document.sha256,
            generation=blob.generation,
            updated_at=updated_at,
        )

    async def _resolve_retry(
        self,
        blob: KnowledgeBlob,
        document: CompiledKnowledgeDocument,
        object_name: str,
    ) -> KnowledgeArtifact:
        await asyncio.to_thread(
            blob.reload,
            timeout=self._settings.timeout_seconds,
        )
        metadata = blob.metadata or {}
        if metadata.get("sha256") != document.sha256:
            raise KnowledgeWriteConflict from None
        existing_content = await asyncio.to_thread(
            blob.download_as_bytes,
            checksum="auto",
            timeout=self._settings.timeout_seconds,
        )
        if existing_content != document.content:
            raise KnowledgeWriteConflict from None
        try:
            generation = int(blob.generation or 0)
            updated_at = datetime.fromisoformat(
                metadata["updated_at"].replace("Z", "+00:00")
            )
        except (KeyError, ValueError):
            raise KnowledgeWriteConflict from None
        if (
            generation < 1
            or updated_at.tzinfo is None
            or updated_at.utcoffset() is None
        ):
            raise KnowledgeWriteConflict from None
        return KnowledgeArtifact(
            project_id=document.project_id,
            object_name=object_name,
            sha256=document.sha256,
            generation=generation,
            updated_at=updated_at.astimezone(UTC),
        )


def create_gcs_knowledge_repository(
    settings: GcsKnowledgeSettings,
) -> GcsKnowledgeRepository:
    from google.cloud import storage

    return GcsKnowledgeRepository(settings=settings, client=storage.Client())


def _utc_now() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "GcsKnowledgeRepository",
    "GcsKnowledgeSettings",
    "KnowledgeArtifact",
    "KnowledgeWriteConflict",
    "create_gcs_knowledge_repository",
]
