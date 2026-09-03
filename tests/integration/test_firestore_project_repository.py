from __future__ import annotations

from typing import Any

import pytest
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1

from app.firestore_project_repository import (
    FirestoreProjectConflict,
    FirestoreProjectRepository,
    FirestoreProjectSettings,
)


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
            raise AlreadyExists("project mapping already exists")
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


@pytest.mark.asyncio
async def test_slack_channel_is_bound_to_a_deterministic_qali_project() -> None:
    client = _RecordingFirestoreClient()
    repository = FirestoreProjectRepository(
        settings=FirestoreProjectSettings(
            gcp_project_id="qali-507317",
            database_id="(default)",
        ),
        client=client,
    )

    binding = await repository.resolve_or_create(
        workspace_id="T-QALI",
        channel_id="C-PROJECT",
        created_by="slack:U-OWNER",
    )

    assert binding.project_id.startswith("slack-project-")
    assert binding.workspace_id == "T-QALI"
    assert binding.channel_id == "C-PROJECT"
    assert binding.created_by == "slack:U-OWNER"
    assert client.collection_names == ["projects"]
    assert client.collection_reference.document_ids[0].startswith(
        "qali-project-channel-"
    )
    assert client.collection_reference.documents[0].created_documents == [
        {
            **binding.model_dump(mode="python"),
            "created_at": firestore_v1.SERVER_TIMESTAMP,
        }
    ]


@pytest.mark.asyncio
async def test_existing_channel_binding_is_reused_for_a_later_requester() -> None:
    client = _CreateOnlyFirestoreClient()
    repository = FirestoreProjectRepository(
        settings=FirestoreProjectSettings(
            gcp_project_id="qali-507317",
            database_id="(default)",
        ),
        client=client,
    )

    original = await repository.resolve_or_create(
        workspace_id="T-QALI",
        channel_id="C-PROJECT",
        created_by="slack:U-OWNER",
    )
    existing = await repository.resolve_or_create(
        workspace_id="T-QALI",
        channel_id="C-PROJECT",
        created_by="slack:U-COLLABORATOR",
    )

    assert existing == original


@pytest.mark.asyncio
async def test_conflicting_channel_binding_fails_closed_without_replacement() -> None:
    client = _CreateOnlyFirestoreClient()
    repository = FirestoreProjectRepository(
        settings=FirestoreProjectSettings(
            gcp_project_id="qali-507317",
            database_id="(default)",
        ),
        client=client,
    )
    await repository.resolve_or_create(
        workspace_id="T-QALI",
        channel_id="C-PROJECT",
        created_by="slack:U-OWNER",
    )
    stored = client.collection_reference.document_reference.stored_document
    assert stored is not None
    stored["project_id"] = "different-project"

    with pytest.raises(FirestoreProjectConflict) as caught:
        await repository.resolve_or_create(
            workspace_id="T-QALI",
            channel_id="C-PROJECT",
            created_by="slack:U-OWNER",
        )

    assert str(caught.value) == "project channel mapping already exists"
    assert stored["project_id"] == "different-project"
