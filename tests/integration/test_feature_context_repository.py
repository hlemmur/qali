from __future__ import annotations

import hashlib

import pytest
from google.api_core.exceptions import PreconditionFailed

from app.feature_context_loader import FeatureContextUnavailable
from app.feature_context_repository import (
    FeatureContextWriteConflict,
    GcsFeatureContextRepository,
    GcsFeatureContextSettings,
)
from app.knowledge_quality import KnowledgeReadiness
from tests.integration.test_feature_context_loader import _context


class _Blob:
    def __init__(self) -> None:
        self.metadata = None
        self.generation = None
        self.content = b""

    def upload_from_string(self, data: bytes, **kwargs) -> None:
        assert kwargs["content_type"] == "application/json"
        assert kwargs["checksum"] == "auto"
        assert kwargs["timeout"] == 17
        expected = kwargs["if_generation_match"]
        current = self.generation or 0
        if expected != current:
            raise PreconditionFailed("synthetic generation conflict")
        self.content = data
        self.generation = current + 1

    def reload(self, **kwargs) -> None:
        del kwargs

    def download_as_bytes(self, **kwargs) -> bytes:
        assert kwargs["checksum"] == "auto"
        assert kwargs["timeout"] == 17
        return self.content


class _Bucket:
    def __init__(self) -> None:
        self.blobs = {}

    def blob(self, object_name: str) -> _Blob:
        return self.blobs.setdefault(object_name, _Blob())


class _Storage:
    def __init__(self) -> None:
        self.value = _Bucket()

    def bucket(self, bucket_name: str) -> _Bucket:
        assert bucket_name == "qali-artifacts"
        return self.value


@pytest.mark.asyncio
async def test_published_approved_context_is_retrievable_with_integrity_metadata() -> (
    None
):
    storage = _Storage()
    repository = GcsFeatureContextRepository(
        settings=GcsFeatureContextSettings(
            bucket_name="qali-artifacts",
            timeout_seconds=17,
        ),
        client=storage,
    )

    pointer = await repository.publish(_context(), expected_generation=0)
    loaded = await repository.load("project-alpha")

    assert loaded == _context()
    assert pointer.object_name == "projects/project-alpha/context/feature.json"
    assert pointer.generation == 1
    assert (
        pointer.sha256
        == hashlib.sha256(_context().model_dump_json().encode()).hexdigest()
    )
    blob = storage.value.blobs[pointer.object_name]
    assert blob.metadata == {
        "project_id": "project-alpha",
        "sha256": pointer.sha256,
    }


@pytest.mark.asyncio
async def test_identical_publish_retry_returns_the_existing_context_pointer() -> None:
    repository = GcsFeatureContextRepository(
        settings=GcsFeatureContextSettings(
            bucket_name="qali-artifacts",
            timeout_seconds=17,
        ),
        client=_Storage(),
    )

    first = await repository.publish(_context(), expected_generation=0)
    retry = await repository.publish(_context(), expected_generation=0)

    assert retry == first


@pytest.mark.asyncio
async def test_unready_context_cannot_be_published_as_approved() -> None:
    repository = GcsFeatureContextRepository(
        settings=GcsFeatureContextSettings(bucket_name="qali-artifacts"),
        client=_Storage(),
    )
    unready = _context().model_copy(
        update={"readiness": KnowledgeReadiness.INSUFFICIENT}
    )

    with pytest.raises(ValueError, match="context must be ready"):
        await repository.publish(unready, expected_generation=0)


@pytest.mark.asyncio
async def test_changed_stale_publish_is_rejected_as_a_generation_conflict() -> None:
    repository = GcsFeatureContextRepository(
        settings=GcsFeatureContextSettings(
            bucket_name="qali-artifacts",
            timeout_seconds=17,
        ),
        client=_Storage(),
    )
    await repository.publish(_context(), expected_generation=0)
    changed = _context().model_copy(update={"channel_id": "C-CHANGED"})

    with pytest.raises(FeatureContextWriteConflict):
        await repository.publish(changed, expected_generation=0)


@pytest.mark.asyncio
async def test_tampered_context_content_fails_closed_on_load() -> None:
    storage = _Storage()
    repository = GcsFeatureContextRepository(
        settings=GcsFeatureContextSettings(
            bucket_name="qali-artifacts",
            timeout_seconds=17,
        ),
        client=storage,
    )
    pointer = await repository.publish(_context(), expected_generation=0)
    storage.value.blobs[pointer.object_name].content += b" "

    with pytest.raises(
        FeatureContextUnavailable,
        match=r"^approved feature context is unavailable$",
    ):
        await repository.load("project-alpha")
