from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

import pytest
from google.api_core.exceptions import PreconditionFailed

from app.knowledge_markdown import CompiledKnowledgeDocument
from app.knowledge_repository import (
    GcsKnowledgeRepository,
    GcsKnowledgeSettings,
    KnowledgeWriteConflict,
)


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
        self.metadata = (
            None if self.stored_metadata is None else self.stored_metadata.copy()
        )

    def download_as_bytes(self, **kwargs: Any) -> bytes:
        del kwargs
        assert self.stored_data is not None
        return self.stored_data


class _Bucket:
    def __init__(self) -> None:
        self.object_names: list[str] = []
        self.blob_reference = _VersionedBlob()

    def blob(self, object_name: str) -> _VersionedBlob:
        self.object_names.append(object_name)
        return self.blob_reference


class _StorageClient:
    def __init__(self) -> None:
        self.bucket_names: list[str] = []
        self.bucket_reference = _Bucket()

    def bucket(self, bucket_name: str) -> _Bucket:
        self.bucket_names.append(bucket_name)
        return self.bucket_reference


def _document(content: bytes = b"# Project Knowledge\n") -> CompiledKnowledgeDocument:
    return CompiledKnowledgeDocument(
        project_id="slack-project-alpha",
        content=content,
        sha256=hashlib.sha256(content).hexdigest(),
    )


@pytest.mark.asyncio
async def test_compiled_knowledge_is_published_with_generation_precondition() -> None:
    client = _StorageClient()
    repository = GcsKnowledgeRepository(
        settings=GcsKnowledgeSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: datetime(2026, 9, 4, 1, 30, tzinfo=UTC),
    )
    document = _document()

    artifact = await repository.publish(document, expected_generation=0)

    assert artifact.object_name == ("projects/slack-project-alpha/knowledge/index.md")
    assert artifact.generation == 1
    assert artifact.sha256 == document.sha256
    assert client.bucket_names == ["qali-private-artifacts"]
    assert client.bucket_reference.object_names == [artifact.object_name]
    assert client.bucket_reference.blob_reference.stored_metadata == {
        "sha256": document.sha256,
        "updated_at": "2026-09-04T01:30:00Z",
    }
    assert client.bucket_reference.blob_reference.uploads == [
        {
            "data": document.content,
            "content_type": "text/markdown",
            "if_generation_match": 0,
            "checksum": "auto",
            "timeout": 60,
        }
    ]


@pytest.mark.asyncio
async def test_identical_publication_retry_reuses_the_existing_generation() -> None:
    client = _StorageClient()
    repository = GcsKnowledgeRepository(
        settings=GcsKnowledgeSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: datetime(2026, 9, 4, 1, 35, tzinfo=UTC),
    )
    document = _document()

    first = await repository.publish(document, expected_generation=0)
    retry = await repository.publish(document, expected_generation=0)

    assert retry == first
    assert client.bucket_reference.blob_reference.stored_data == document.content


@pytest.mark.asyncio
async def test_stale_generation_cannot_overwrite_different_knowledge() -> None:
    client = _StorageClient()
    repository = GcsKnowledgeRepository(
        settings=GcsKnowledgeSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: datetime(2026, 9, 4, 1, 40, tzinfo=UTC),
    )
    original = _document()
    changed = _document(b"# Changed Knowledge\n")
    await repository.publish(original, expected_generation=0)

    with pytest.raises(KnowledgeWriteConflict) as caught:
        await repository.publish(changed, expected_generation=0)

    assert str(caught.value) == "compiled knowledge generation conflict"
    assert client.bucket_reference.blob_reference.stored_data == original.content


@pytest.mark.asyncio
async def test_matching_generation_can_publish_an_incremental_update() -> None:
    timestamps = iter(
        (
            datetime(2026, 9, 4, 1, 45, tzinfo=UTC),
            datetime(2026, 9, 4, 1, 46, tzinfo=UTC),
        )
    )
    client = _StorageClient()
    repository = GcsKnowledgeRepository(
        settings=GcsKnowledgeSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: next(timestamps),
    )
    first = await repository.publish(_document(), expected_generation=0)
    changed = _document(b"# Project Knowledge\n\nUpdated.\n")

    updated = await repository.publish(
        changed,
        expected_generation=first.generation,
    )

    assert updated.generation == 2
    assert updated.sha256 == changed.sha256
    assert client.bucket_reference.blob_reference.stored_data == changed.content
