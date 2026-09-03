from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

from google.api_core.exceptions import PreconditionFailed
from pydantic import BaseModel, ConfigDict, Field

from app.source_screening import ScreenedSource, SourceScreeningStage

_RESOURCE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"


class GcsRawSourceSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    bucket_name: str = Field(min_length=1)
    upload_timeout_seconds: int = Field(default=60, ge=1, le=300)


class RawSourceProvenance(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    author_ref: str = Field(min_length=1, max_length=256)


class RawSourceArtifact(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    source_id: str
    object_name: str
    source_uri: str
    source_uri_sha256: str
    content_type: str
    sha256: str
    captured_at: datetime
    provenance: RawSourceProvenance
    screening_scanners: tuple[str, ...]


class RawSourceSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    artifact: RawSourceArtifact
    content: bytes


class StorageBlob(Protocol):
    metadata: dict[str, str] | None

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None: ...

    def reload(self, **kwargs: Any) -> None: ...

    def download_as_bytes(self, **kwargs: Any) -> bytes: ...


class StorageBucket(Protocol):
    def blob(self, blob_name: str) -> StorageBlob: ...


class StorageClient(Protocol):
    def bucket(self, bucket_name: str) -> StorageBucket: ...


class RawSourceConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("raw source identifier already exists")


class RawSourceIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("raw source integrity verification failed")


class GcsRawSourceRepository:
    def __init__(
        self,
        *,
        settings: GcsRawSourceSettings,
        client: StorageClient,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        self._clock = clock or _utc_now

    async def persist(
        self,
        *,
        project_id: str,
        source_id: str,
        source: ScreenedSource,
        provenance: RawSourceProvenance,
    ) -> RawSourceArtifact:
        project_id = _validate_resource_id("project_id", project_id)
        source_id = _validate_resource_id("source_id", source_id)
        if not source.decisions or any(
            decision.threats for decision in source.decisions
        ):
            raise ValueError("raw persistence requires clean screening decisions")
        if tuple(decision.stage for decision in source.decisions) != (
            SourceScreeningStage.MALWARE,
            SourceScreeningStage.INSTRUCTION,
        ):
            raise ValueError("raw persistence requires complete screening decisions")
        captured_at = self._clock()
        if captured_at.tzinfo is None or captured_at.utcoffset() is None:
            raise ValueError("raw source clock must return a timezone-aware datetime")
        captured_at = captured_at.astimezone(UTC)
        digest = hashlib.sha256(source.source.content).hexdigest()
        source_uri = _redacted_source_uri(source.source.url)
        source_uri_sha256 = hashlib.sha256(source.source.url.encode()).hexdigest()
        object_name = f"projects/{project_id}/raw/{source_id}/source"
        scanners = tuple(decision.scanner for decision in source.decisions)
        artifact = RawSourceArtifact(
            project_id=project_id,
            source_id=source_id,
            object_name=object_name,
            source_uri=source_uri,
            source_uri_sha256=source_uri_sha256,
            content_type=source.source.content_type,
            sha256=digest,
            captured_at=captured_at,
            provenance=provenance,
            screening_scanners=scanners,
        )
        blob = self._client.bucket(self._settings.bucket_name).blob(object_name)
        expected_metadata = {
            "author_ref": provenance.author_ref,
            "captured_at": captured_at.isoformat().replace("+00:00", "Z"),
            "sha256": digest,
            "source_uri": source_uri,
            "source_uri_sha256": source_uri_sha256,
            "screening_scanners": json.dumps(scanners, separators=(",", ":")),
        }
        blob.metadata = expected_metadata
        try:
            await asyncio.to_thread(
                blob.upload_from_string,
                source.source.content,
                content_type=source.source.content_type,
                if_generation_match=0,
                checksum="auto",
                timeout=self._settings.upload_timeout_seconds,
            )
        except PreconditionFailed:
            await asyncio.to_thread(
                blob.reload,
                timeout=self._settings.upload_timeout_seconds,
            )
            existing_metadata = blob.metadata or {}
            stable_keys = (
                "author_ref",
                "sha256",
                "source_uri",
                "source_uri_sha256",
                "screening_scanners",
            )
            if any(
                existing_metadata.get(key) != expected_metadata[key]
                for key in stable_keys
            ):
                raise RawSourceConflict from None
            try:
                original_captured_at = datetime.fromisoformat(
                    existing_metadata["captured_at"].replace("Z", "+00:00")
                )
            except (KeyError, ValueError):
                raise RawSourceConflict from None
            artifact = artifact.model_copy(update={"captured_at": original_captured_at})
        return artifact

    async def read(self, artifact: RawSourceArtifact) -> RawSourceSnapshot:
        try:
            project_id = _validate_resource_id("project_id", artifact.project_id)
            source_id = _validate_resource_id("source_id", artifact.source_id)
        except ValueError:
            raise RawSourceIntegrityError from None
        expected_object_name = f"projects/{project_id}/raw/{source_id}/source"
        if artifact.object_name != expected_object_name:
            raise RawSourceIntegrityError
        captured_at = artifact.captured_at
        if captured_at.tzinfo is None or captured_at.utcoffset() is None:
            raise RawSourceIntegrityError
        expected_metadata = {
            "author_ref": artifact.provenance.author_ref,
            "captured_at": captured_at.astimezone(UTC)
            .isoformat()
            .replace("+00:00", "Z"),
            "sha256": artifact.sha256,
            "source_uri": artifact.source_uri,
            "source_uri_sha256": artifact.source_uri_sha256,
            "screening_scanners": json.dumps(
                artifact.screening_scanners,
                separators=(",", ":"),
            ),
        }
        blob = self._client.bucket(self._settings.bucket_name).blob(
            expected_object_name
        )
        await asyncio.to_thread(
            blob.reload,
            timeout=self._settings.upload_timeout_seconds,
        )
        metadata = blob.metadata or {}
        if any(metadata.get(key) != value for key, value in expected_metadata.items()):
            raise RawSourceIntegrityError
        content = await asyncio.to_thread(
            blob.download_as_bytes,
            checksum="auto",
            timeout=self._settings.upload_timeout_seconds,
        )
        if hashlib.sha256(content).hexdigest() != artifact.sha256:
            raise RawSourceIntegrityError
        return RawSourceSnapshot(artifact=artifact, content=content)


def create_gcs_raw_source_repository(
    settings: GcsRawSourceSettings,
) -> GcsRawSourceRepository:
    from google.cloud import storage

    return GcsRawSourceRepository(settings=settings, client=storage.Client())


def _validate_resource_id(field_name: str, value: str) -> str:
    if re.fullmatch(_RESOURCE_ID_PATTERN, value) is None:
        raise ValueError(f"{field_name} is not a safe resource identifier") from None
    return value


def _redacted_source_uri(value: str) -> str:
    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def _utc_now() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "GcsRawSourceRepository",
    "GcsRawSourceSettings",
    "RawSourceArtifact",
    "RawSourceConflict",
    "RawSourceIntegrityError",
    "RawSourceProvenance",
    "RawSourceSnapshot",
    "create_gcs_raw_source_repository",
]
