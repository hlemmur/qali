from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1

from app.firestore_source_repository import (
    FirestoreSourceConflict,
    FirestoreSourceIntegrityError,
    FirestoreSourceRepository,
    FirestoreSourceSettings,
)
from app.raw_source_repository import RawSourceArtifact, RawSourceProvenance


class _RecordingDocument:
    def __init__(self, document_id: str) -> None:
        self.document_id = document_id
        self.created_documents: list[dict[str, Any]] = []

    async def create(self, document_data: dict[str, Any]) -> None:
        self.created_documents.append(document_data)


class _RecordingCollection:
    def __init__(self) -> None:
        self.document_ids: list[str] = []
        self.documents: list[_RecordingDocument] = []

    def document(self, document_id: str) -> _RecordingDocument:
        self.document_ids.append(document_id)
        document = _RecordingDocument(document_id)
        self.documents.append(document)
        return document


class _RecordingFirestoreClient:
    def __init__(self) -> None:
        self.collection_names: list[str] = []
        self.collection_reference = _RecordingCollection()

    def collection(self, collection_name: str) -> _RecordingCollection:
        self.collection_names.append(collection_name)
        return self.collection_reference


class _Snapshot:
    def __init__(self, data: dict[str, Any] | None) -> None:
        self.exists = data is not None
        self._data = data

    def to_dict(self) -> dict[str, Any] | None:
        return None if self._data is None else self._data.copy()


class _CreateOnlyDocument(_RecordingDocument):
    def __init__(self, document_id: str) -> None:
        super().__init__(document_id)
        self.stored_document: dict[str, Any] | None = None

    async def create(self, document_data: dict[str, Any]) -> None:
        self.created_documents.append(document_data)
        if self.stored_document is not None:
            raise AlreadyExists("source metadata already exists")
        self.stored_document = document_data.copy()

    async def get(self) -> _Snapshot:
        return _Snapshot(self.stored_document)


class _CreateOnlyCollection(_RecordingCollection):
    def __init__(self) -> None:
        super().__init__()
        self.document_reference = _CreateOnlyDocument("")

    def document(self, document_id: str) -> _CreateOnlyDocument:
        self.document_ids.append(document_id)
        self.document_reference.document_id = document_id
        return self.document_reference


class _CreateOnlyFirestoreClient(_RecordingFirestoreClient):
    def __init__(self) -> None:
        super().__init__()
        self.collection_reference = _CreateOnlyCollection()


def _artifact() -> RawSourceArtifact:
    return RawSourceArtifact(
        project_id="project-alpha",
        source_id="source-001",
        object_name="projects/project-alpha/raw/source-001/source",
        source_uri="https://docs.example.test/product.md",
        source_uri_sha256="a" * 64,
        content_type="text/markdown",
        sha256="b" * 64,
        captured_at=datetime(2026, 9, 3, 18, 0, tzinfo=UTC),
        provenance=RawSourceProvenance(author_ref="slack:U-OWNER"),
        screening_scanners=("malware-v1", "instruction-v1"),
    )


class _SourceQuery:
    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents
        self.filters: list[Any] = []

    def where(self, *, filter: Any) -> _SourceQuery:
        self.filters.append(filter)
        return self

    async def stream(self):
        for document in self.documents:
            yield _Snapshot(document)


class _QueryingFirestoreClient:
    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.collection_names: list[str] = []
        self.query = _SourceQuery(documents)

    def collection(self, collection_name: str) -> _SourceQuery:
        self.collection_names.append(collection_name)
        return self.query


@pytest.mark.asyncio
async def test_raw_artifact_metadata_is_indexed_once_without_source_bytes() -> None:
    client = _RecordingFirestoreClient()
    repository = FirestoreSourceRepository(
        settings=FirestoreSourceSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="sources",
        ),
        client=client,
    )
    artifact = _artifact()

    created = await repository.create(artifact)

    assert created is True
    assert client.collection_names == ["sources"]
    assert client.collection_reference.document_ids[0].startswith("qali-source-")
    document = client.collection_reference.documents[0].created_documents[0]
    assert document == {
        **artifact.model_dump(mode="python"),
        "indexed_at": firestore_v1.SERVER_TIMESTAMP,
    }
    assert "content" not in document


@pytest.mark.asyncio
async def test_existing_source_metadata_cannot_be_replaced_by_different_artifact() -> (
    None
):
    client = _CreateOnlyFirestoreClient()
    repository = FirestoreSourceRepository(
        settings=FirestoreSourceSettings(
            project_id="qali-507317",
            database_id="(default)",
        ),
        client=client,
    )
    original = _artifact()
    changed = original.model_copy(update={"sha256": "c" * 64})
    assert await repository.create(original) is True

    with pytest.raises(FirestoreSourceConflict) as caught:
        await repository.create(changed)

    assert str(caught.value) == "source metadata already exists"
    assert client.collection_reference.document_reference.stored_document == {
        **original.model_dump(mode="python"),
        "indexed_at": firestore_v1.SERVER_TIMESTAMP,
    }


@pytest.mark.asyncio
async def test_identical_source_metadata_retry_is_idempotent() -> None:
    client = _CreateOnlyFirestoreClient()
    repository = FirestoreSourceRepository(
        settings=FirestoreSourceSettings(
            project_id="qali-507317",
            database_id="(default)",
        ),
        client=client,
    )
    artifact = _artifact()

    assert await repository.create(artifact) is True
    assert await repository.create(artifact) is False
    assert client.collection_reference.document_reference.stored_document == {
        **artifact.model_dump(mode="python"),
        "indexed_at": firestore_v1.SERVER_TIMESTAMP,
    }


@pytest.mark.asyncio
async def test_project_sources_are_recovered_in_deterministic_order() -> None:
    later = _artifact().model_copy(
        update={
            "source_id": "source-002",
            "object_name": "projects/project-alpha/raw/source-002/source",
            "captured_at": datetime(2026, 9, 3, 19, 0, tzinfo=UTC),
        }
    )
    earlier = _artifact()
    client = _QueryingFirestoreClient(
        [
            {**later.model_dump(mode="python"), "indexed_at": "ignored"},
            {**earlier.model_dump(mode="python"), "indexed_at": "ignored"},
        ]
    )
    repository = FirestoreSourceRepository(
        settings=FirestoreSourceSettings(
            project_id="qali-507317",
            database_id="(default)",
        ),
        client=client,
    )

    recovered = await repository.list_for_project("project-alpha")

    assert recovered == (earlier, later)
    assert client.collection_names == ["sources"]
    assert len(client.query.filters) == 1
    query_filter = client.query.filters[0]
    assert query_filter.field_path == "project_id"
    assert query_filter.op_string == "=="
    assert query_filter.value == "project-alpha"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "documents",
    [
        [{**_artifact().model_dump(mode="python"), "project_id": "other-project"}],
        [{"project_id": "project-alpha", "source_id": "broken"}],
        [
            _artifact().model_dump(mode="python"),
            _artifact().model_dump(mode="python"),
        ],
    ],
    ids=("cross-project", "malformed", "duplicate-source-id"),
)
async def test_source_recovery_fails_closed_for_corrupt_index(
    documents: list[dict[str, Any]],
) -> None:
    repository = FirestoreSourceRepository(
        settings=FirestoreSourceSettings(
            project_id="qali-507317",
            database_id="(default)",
        ),
        client=_QueryingFirestoreClient(documents),
    )

    with pytest.raises(FirestoreSourceIntegrityError) as caught:
        await repository.list_for_project("project-alpha")

    assert str(caught.value) == "source metadata integrity verification failed"
