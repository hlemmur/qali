from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

import pytest
from google.api_core.exceptions import PreconditionFailed

from app.run_artifact_repository import (
    GcsRunArtifactRepository,
    GcsRunArtifactSettings,
    InMemoryRunArtifactRepository,
    RunArtifactWriteConflict,
)
from app.run_artifacts import RunArtifactDocument, compile_feature_run_artifacts
from tests.integration.test_run_artifacts import _failed_run


class _Blob:
    def __init__(self) -> None:
        self.metadata: dict[str, str] | None = None
        self.stored_metadata: dict[str, str] | None = None
        self.data: bytes | None = None
        self.generation: int | None = None
        self.uploads: list[dict[str, Any]] = []

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None:
        self.uploads.append({"data": data, **kwargs})
        if self.generation is not None:
            raise PreconditionFailed("already exists")
        self.generation = 1
        self.data = data
        self.stored_metadata = None if self.metadata is None else self.metadata.copy()

    def reload(self, **kwargs: Any) -> None:
        del kwargs
        self.metadata = (
            None if self.stored_metadata is None else self.stored_metadata.copy()
        )

    def download_as_bytes(self, **kwargs: Any) -> bytes:
        del kwargs
        assert self.data is not None
        return self.data


class _Bucket:
    def __init__(self) -> None:
        self.blobs: dict[str, _Blob] = {}

    def blob(self, object_name: str) -> _Blob:
        return self.blobs.setdefault(object_name, _Blob())


class _Client:
    def __init__(self) -> None:
        self.bucket_name: str | None = None
        self.bucket_reference = _Bucket()

    def bucket(self, bucket_name: str) -> _Bucket:
        self.bucket_name = bucket_name
        return self.bucket_reference


def _changed(document: RunArtifactDocument) -> RunArtifactDocument:
    content = document.content + b"changed\n"
    return document.model_copy(
        update={"content": content, "sha256": hashlib.sha256(content).hexdigest()}
    )


@pytest.mark.asyncio
async def test_mock_repository_is_immutable_and_idempotent() -> None:
    bundle = compile_feature_run_artifacts(await _failed_run())
    repository = InMemoryRunArtifactRepository(
        clock=lambda: datetime(2026, 9, 8, 8, 30, tzinfo=UTC)
    )

    first = await repository.publish(bundle)
    retry = await repository.publish(bundle)

    assert retry == first
    assert len(first.artifacts) == 5
    assert await repository.read(first.artifacts[0].object_name) == bundle.documents[0]

    changed = bundle.model_copy(
        update={"documents": (_changed(bundle.documents[0]), *bundle.documents[1:])}
    )
    with pytest.raises(RunArtifactWriteConflict):
        await repository.publish(changed)


@pytest.mark.asyncio
async def test_gcs_repository_uses_create_only_writes_and_safe_retry() -> None:
    bundle = compile_feature_run_artifacts(await _failed_run())
    client = _Client()
    repository = GcsRunArtifactRepository(
        settings=GcsRunArtifactSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: datetime(2026, 9, 8, 8, 45, tzinfo=UTC),
    )

    first = await repository.publish(bundle)
    retry = await repository.publish(bundle)

    assert retry == first
    assert client.bucket_name == "qali-private-artifacts"
    for document in bundle.documents:
        blob = client.bucket_reference.blobs[document.object_name]
        assert blob.data == document.content
        assert blob.stored_metadata == {
            "sha256": document.sha256,
            "project_id": bundle.project_id,
            "run_id": bundle.run_id,
            "created_at": "2026-09-08T08:45:00Z",
        }
        assert blob.uploads[0]["if_generation_match"] == 0
        assert blob.uploads[0]["content_type"] == document.content_type

    changed = bundle.model_copy(
        update={"documents": (_changed(bundle.documents[0]), *bundle.documents[1:])}
    )
    with pytest.raises(RunArtifactWriteConflict):
        await repository.publish(changed)
