from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

import pytest
from google.api_core.exceptions import PreconditionFailed

from app.raw_source_repository import (
    GcsRawSourceRepository,
    GcsRawSourceSettings,
    RawSourceConflict,
    RawSourceProvenance,
)
from app.source_fetcher import FetchedSource
from app.source_screening import (
    ScreenedSource,
    SourceScreeningDecision,
    SourceScreeningStage,
    SourceThreat,
)


class _RecordingBlob:
    def __init__(self, name: str) -> None:
        self.name = name
        self.metadata: dict[str, str] | None = None
        self.uploads: list[dict[str, Any]] = []

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None:
        self.uploads.append({"data": data, **kwargs})


class _RecordingBucket:
    def __init__(self) -> None:
        self.blob_names: list[str] = []
        self.blobs: list[_RecordingBlob] = []

    def blob(self, blob_name: str) -> _RecordingBlob:
        self.blob_names.append(blob_name)
        blob = _RecordingBlob(blob_name)
        self.blobs.append(blob)
        return blob


class _RecordingStorageClient:
    def __init__(self) -> None:
        self.bucket_names: list[str] = []
        self.bucket_reference = _RecordingBucket()

    def bucket(self, bucket_name: str) -> _RecordingBucket:
        self.bucket_names.append(bucket_name)
        return self.bucket_reference


class _CreateOnlyBlob(_RecordingBlob):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.stored_data: bytes | None = None
        self.stored_metadata: dict[str, str] | None = None

    def upload_from_string(self, data: bytes, **kwargs: Any) -> None:
        self.uploads.append({"data": data, **kwargs})
        if self.stored_data is not None:
            raise PreconditionFailed("generation precondition failed")
        self.stored_data = data
        self.stored_metadata = None if self.metadata is None else self.metadata.copy()

    def reload(self, **kwargs: Any) -> None:
        del kwargs
        self.metadata = (
            None if self.stored_metadata is None else self.stored_metadata.copy()
        )


class _CreateOnlyBucket(_RecordingBucket):
    def __init__(self) -> None:
        super().__init__()
        self.blob_reference = _CreateOnlyBlob("")

    def blob(self, blob_name: str) -> _CreateOnlyBlob:
        self.blob_names.append(blob_name)
        self.blob_reference.name = blob_name
        return self.blob_reference


class _CreateOnlyStorageClient(_RecordingStorageClient):
    def __init__(self) -> None:
        super().__init__()
        self.bucket_reference = _CreateOnlyBucket()


@pytest.mark.asyncio
async def test_screened_source_is_persisted_as_create_only_gcs_object() -> None:
    captured_at = datetime(2026, 9, 3, 17, 30, tzinfo=UTC)
    content = b"# Product\nCustomers can update their profile."
    screened = ScreenedSource(
        source=FetchedSource(
            url="https://docs.example.test/product.md",
            content_type="text/markdown",
            content=content,
        ),
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(),
            ),
            SourceScreeningDecision(
                stage=SourceScreeningStage.INSTRUCTION,
                scanner="instruction-v1",
                threats=(),
            ),
        ),
    )
    client = _RecordingStorageClient()
    repository = GcsRawSourceRepository(
        settings=GcsRawSourceSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: captured_at,
    )

    artifact = await repository.persist(
        project_id="project-alpha",
        source_id="source-001",
        source=screened,
        provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
    )

    digest = hashlib.sha256(content).hexdigest()
    assert artifact.object_name == "projects/project-alpha/raw/source-001/source"
    assert artifact.sha256 == digest
    assert artifact.captured_at == captured_at
    assert client.bucket_names == ["qali-private-artifacts"]
    blob = client.bucket_reference.blobs[0]
    assert blob.metadata == {
        "author_ref": "slack:U-OWNER",
        "captured_at": "2026-09-03T17:30:00Z",
        "sha256": digest,
        "source_uri": "https://docs.example.test/product.md",
        "source_uri_sha256": hashlib.sha256(
            b"https://docs.example.test/product.md"
        ).hexdigest(),
        "screening_scanners": '["malware-v1","instruction-v1"]',
    }
    assert blob.uploads == [
        {
            "data": content,
            "content_type": "text/markdown",
            "if_generation_match": 0,
            "checksum": "auto",
            "timeout": 60,
        }
    ]


@pytest.mark.asyncio
async def test_source_with_any_threat_cannot_reach_raw_storage() -> None:
    source = ScreenedSource(
        source=FetchedSource(
            url="https://docs.example.test/unsafe.txt",
            content_type="text/plain",
            content=b"malicious content",
        ),
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(SourceThreat.MALWARE,),
            ),
        ),
    )
    client = _RecordingStorageClient()
    repository = GcsRawSourceRepository(
        settings=GcsRawSourceSettings(bucket_name="qali-private-artifacts"),
        client=client,
    )

    with pytest.raises(ValueError, match="clean screening decisions"):
        await repository.persist(
            project_id="project-alpha",
            source_id="source-unsafe",
            source=source,
            provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
        )

    assert client.bucket_names == []


@pytest.mark.asyncio
async def test_incomplete_screening_cannot_reach_raw_storage() -> None:
    source = ScreenedSource(
        source=FetchedSource(
            url="https://docs.example.test/incomplete.txt",
            content_type="text/plain",
            content=b"only one scanner ran",
        ),
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(),
            ),
        ),
    )
    client = _RecordingStorageClient()
    repository = GcsRawSourceRepository(
        settings=GcsRawSourceSettings(bucket_name="qali-private-artifacts"),
        client=client,
    )

    with pytest.raises(ValueError, match="complete screening decisions"):
        await repository.persist(
            project_id="project-alpha",
            source_id="source-incomplete",
            source=source,
            provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
        )

    assert client.bucket_names == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("project_id", "source_id"),
    (("../escape", "source-001"), ("project-alpha", "../escape")),
)
async def test_resource_identifiers_cannot_escape_project_raw_prefix(
    project_id: str,
    source_id: str,
) -> None:
    source = ScreenedSource(
        source=FetchedSource(
            url="https://docs.example.test/product.txt",
            content_type="text/plain",
            content=b"safe content",
        ),
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(),
            ),
            SourceScreeningDecision(
                stage=SourceScreeningStage.INSTRUCTION,
                scanner="instruction-v1",
                threats=(),
            ),
        ),
    )
    client = _RecordingStorageClient()
    repository = GcsRawSourceRepository(
        settings=GcsRawSourceSettings(bucket_name="qali-private-artifacts"),
        client=client,
    )

    with pytest.raises(ValueError, match="safe resource identifier"):
        await repository.persist(
            project_id=project_id,
            source_id=source_id,
            source=source,
            provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
        )

    assert client.bucket_names == []


@pytest.mark.asyncio
async def test_identical_retry_reuses_existing_immutable_raw_source() -> None:
    captured_at = iter(
        (
            datetime(2026, 9, 3, 17, 45, tzinfo=UTC),
            datetime(2026, 9, 3, 17, 46, tzinfo=UTC),
        )
    )
    source = ScreenedSource(
        source=FetchedSource(
            url="https://docs.example.test/retry.txt",
            content_type="text/plain",
            content=b"retry-safe content",
        ),
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(),
            ),
            SourceScreeningDecision(
                stage=SourceScreeningStage.INSTRUCTION,
                scanner="instruction-v1",
                threats=(),
            ),
        ),
    )
    client = _CreateOnlyStorageClient()
    repository = GcsRawSourceRepository(
        settings=GcsRawSourceSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: next(captured_at),
    )
    provenance = RawSourceProvenance(author_ref="slack:U-OWNER")

    first = await repository.persist(
        project_id="project-alpha",
        source_id="source-retry",
        source=source,
        provenance=provenance,
    )
    retried = await repository.persist(
        project_id="project-alpha",
        source_id="source-retry",
        source=source,
        provenance=provenance,
    )

    assert retried == first
    assert client.bucket_reference.blob_reference.stored_data == source.source.content


@pytest.mark.asyncio
async def test_existing_source_id_cannot_be_overwritten_with_different_content() -> (
    None
):
    captured_at = datetime(2026, 9, 3, 17, 50, tzinfo=UTC)
    clean_decisions = (
        SourceScreeningDecision(
            stage=SourceScreeningStage.MALWARE,
            scanner="malware-v1",
            threats=(),
        ),
        SourceScreeningDecision(
            stage=SourceScreeningStage.INSTRUCTION,
            scanner="instruction-v1",
            threats=(),
        ),
    )
    original = ScreenedSource(
        source=FetchedSource(
            url="https://docs.example.test/immutable.txt",
            content_type="text/plain",
            content=b"original content",
        ),
        decisions=clean_decisions,
    )
    changed = original.model_copy(
        update={
            "source": original.source.model_copy(update={"content": b"changed content"})
        }
    )
    client = _CreateOnlyStorageClient()
    repository = GcsRawSourceRepository(
        settings=GcsRawSourceSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: captured_at,
    )
    provenance = RawSourceProvenance(author_ref="slack:U-OWNER")
    await repository.persist(
        project_id="project-alpha",
        source_id="source-immutable",
        source=original,
        provenance=provenance,
    )

    with pytest.raises(RawSourceConflict) as caught:
        await repository.persist(
            project_id="project-alpha",
            source_id="source-immutable",
            source=changed,
            provenance=provenance,
        )

    assert str(caught.value) == "raw source identifier already exists"
    assert client.bucket_reference.blob_reference.stored_data == b"original content"


@pytest.mark.asyncio
async def test_source_query_secrets_are_not_persisted_in_provenance() -> None:
    secret = "source-secret-123"
    source = ScreenedSource(
        source=FetchedSource(
            url=(
                "https://docs.example.test/download?"
                f"X-Goog-Signature={secret}&version=2"
            ),
            content_type="text/plain",
            content=b"safe content",
        ),
        decisions=(
            SourceScreeningDecision(
                stage=SourceScreeningStage.MALWARE,
                scanner="malware-v1",
                threats=(),
            ),
            SourceScreeningDecision(
                stage=SourceScreeningStage.INSTRUCTION,
                scanner="instruction-v1",
                threats=(),
            ),
        ),
    )
    client = _RecordingStorageClient()
    repository = GcsRawSourceRepository(
        settings=GcsRawSourceSettings(bucket_name="qali-private-artifacts"),
        client=client,
        clock=lambda: datetime(2026, 9, 3, 17, 55, tzinfo=UTC),
    )

    artifact = await repository.persist(
        project_id="project-alpha",
        source_id="source-signed-url",
        source=source,
        provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
    )

    assert artifact.source_uri == "https://docs.example.test/download"
    assert secret not in artifact.model_dump_json()
    assert secret not in str(client.bucket_reference.blobs[0].metadata)
