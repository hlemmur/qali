from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from google.api_core.exceptions import AlreadyExists

from app.project_identity import project_id_for_channel
from app.project_metadata_cleanup import (
    FirestoreProjectMetadataCleaner,
    InMemoryProjectMetadataCleaner,
    InMemoryProjectMetadataDocument,
    ProjectMetadataCleanupIntegrityError,
    ProjectMetadataCleanupRequest,
    ProjectMetadataCleanupSettings,
)


@dataclass
class FakeSnapshot:
    reference: FakeDocument

    @property
    def exists(self) -> bool:
        return self.reference.data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return None if self.reference.data is None else dict(self.reference.data)


class FakeDocument:
    def __init__(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        self.path = f"{collection}/{document_id}"
        self.id = document_id
        self.data = data

    async def create(self, document_data: dict[str, Any]) -> None:
        if self.data is not None:
            raise AlreadyExists("document already exists")
        self.data = dict(document_data)

    async def get(self) -> FakeSnapshot:
        return FakeSnapshot(self)

    async def update(self, fields: dict[str, Any]) -> None:
        assert self.data is not None
        self.data.update(fields)

    async def delete(self) -> None:
        self.data = None


class FakeQuery:
    def __init__(self, documents: dict[str, FakeDocument], filter_: Any) -> None:
        self._documents = documents
        self._filter = filter_

    async def stream(self):
        for document in self._documents.values():
            data = document.data
            if (
                data is not None
                and data.get(self._filter.field_path) == self._filter.value
            ):
                yield FakeSnapshot(document)


class FakeCollection:
    def __init__(
        self,
        name: str,
        documents: dict[str, FakeDocument] | None = None,
    ) -> None:
        self.name = name
        self.documents = documents or {}

    def document(self, document_id: str) -> FakeDocument:
        return self.documents.setdefault(
            document_id, FakeDocument(self.name, document_id)
        )

    def where(self, *, filter: Any) -> FakeQuery:
        return FakeQuery(self.documents, filter)


class FakeClient:
    def __init__(self, collections: dict[str, FakeCollection]) -> None:
        self.collections = collections

    def collection(self, name: str) -> FakeCollection:
        return self.collections.setdefault(name, FakeCollection(name))


@pytest.mark.asyncio
async def test_metadata_cleanup_removes_only_project_scope_and_retains_redacted_audit() -> (
    None
):
    workspace_id = "T123"
    channel_id = "C123"
    project_id = project_id_for_channel(workspace_id, channel_id)
    other_project_id = project_id_for_channel(workspace_id, "C999")
    collections = {
        "projects": FakeCollection(
            "projects",
            {
                "target-project": FakeDocument(
                    "projects", "target-project", {"project_id": project_id}
                ),
                "other-project": FakeDocument(
                    "projects", "other-project", {"project_id": other_project_id}
                ),
            },
        ),
        "sources": FakeCollection(
            "sources",
            {
                "target-source": FakeDocument(
                    "sources", "target-source", {"project_id": project_id}
                ),
                "other-source": FakeDocument(
                    "sources", "other-source", {"project_id": other_project_id}
                ),
            },
        ),
        "jobs": FakeCollection(
            "jobs",
            {
                "target-job": FakeDocument(
                    "jobs",
                    "target-job",
                    {"workspace_id": workspace_id, "channel_id": channel_id},
                ),
                "other-job": FakeDocument(
                    "jobs",
                    "other-job",
                    {"workspace_id": workspace_id, "channel_id": "C999"},
                ),
            },
        ),
        "job_locks": FakeCollection("job_locks"),
        "deletion_audit": FakeCollection("deletion_audit"),
    }
    client = FakeClient(collections)
    lock_id = FirestoreProjectMetadataCleaner.lock_document_id(workspace_id, channel_id)
    collections["job_locks"].documents[lock_id] = FakeDocument(
        "job_locks", lock_id, {"active_job_id": "target-job"}
    )
    now = datetime(2026, 9, 11, 8, 0, tzinfo=UTC)
    cleaner = FirestoreProjectMetadataCleaner(
        settings=ProjectMetadataCleanupSettings(
            gcp_project_id="qali-507317", database_id="(default)"
        ),
        client=client,
        clock=lambda: now,
    )
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-123",
        project_id=project_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="a" * 64,
    )

    result = await cleaner.delete_project(request)

    assert result.project_id == project_id
    assert result.deleted_documents == 4
    assert collections["projects"].documents["target-project"].data is None
    assert collections["sources"].documents["target-source"].data is None
    assert collections["jobs"].documents["target-job"].data is None
    assert collections["job_locks"].documents[lock_id].data is None
    assert collections["projects"].documents["other-project"].data is not None
    assert collections["sources"].documents["other-source"].data is not None
    assert collections["jobs"].documents["other-job"].data is not None
    audit = next(iter(collections["deletion_audit"].documents.values())).data
    assert audit is not None
    assert audit["status"] == "completed"
    assert audit["project_id"] == project_id
    assert audit["requester_digest"] == "a" * 64
    assert audit["deleted_documents"] == 4
    assert audit["expires_at"] == now + timedelta(days=90)
    assert workspace_id not in repr(audit)
    assert channel_id not in repr(audit)


@pytest.mark.asyncio
async def test_metadata_cleanup_retry_returns_the_original_completed_result() -> None:
    workspace_id = "T123"
    channel_id = "C123"
    project_id = project_id_for_channel(workspace_id, channel_id)
    collections = {
        "projects": FakeCollection(
            "projects",
            {"target": FakeDocument("projects", "target", {"project_id": project_id})},
        ),
        "deletion_audit": FakeCollection("deletion_audit"),
    }
    cleaner = FirestoreProjectMetadataCleaner(
        settings=ProjectMetadataCleanupSettings(
            gcp_project_id="qali-507317", database_id="(default)"
        ),
        client=FakeClient(collections),
        clock=lambda: datetime(2026, 9, 11, 8, 0, tzinfo=UTC),
    )
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-retry",
        project_id=project_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="b" * 64,
    )

    first = await cleaner.delete_project(request)
    second = await cleaner.delete_project(request)

    assert first == second
    assert second.deleted_documents == 1


@pytest.mark.asyncio
async def test_metadata_cleanup_rejects_reused_deletion_id_for_another_request() -> (
    None
):
    workspace_id = "T123"
    channel_id = "C123"
    project_id = project_id_for_channel(workspace_id, channel_id)
    collections = {
        "projects": FakeCollection("projects"),
        "deletion_audit": FakeCollection("deletion_audit"),
    }
    cleaner = FirestoreProjectMetadataCleaner(
        settings=ProjectMetadataCleanupSettings(
            gcp_project_id="qali-507317", database_id="(default)"
        ),
        client=FakeClient(collections),
        clock=lambda: datetime(2026, 9, 11, 8, 0, tzinfo=UTC),
    )
    first = ProjectMetadataCleanupRequest(
        deletion_id="delete-reused",
        project_id=project_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="c" * 64,
    )
    second = first.model_copy(update={"requester_digest": "d" * 64})

    await cleaner.delete_project(first)
    with pytest.raises(ProjectMetadataCleanupIntegrityError):
        await cleaner.delete_project(second)


@pytest.mark.asyncio
async def test_mock_metadata_cleanup_has_scope_and_retry_parity() -> None:
    workspace_id = "T123"
    channel_id = "C123"
    project_id = project_id_for_channel(workspace_id, channel_id)
    cleaner = InMemoryProjectMetadataCleaner(
        documents=(
            InMemoryProjectMetadataDocument(
                collection="projects",
                document_id="target",
                data={"project_id": project_id},
            ),
            InMemoryProjectMetadataDocument(
                collection="projects",
                document_id="other",
                data={"project_id": "other-project"},
            ),
        ),
        clock=lambda: datetime(2026, 9, 11, 8, 0, tzinfo=UTC),
    )
    request = ProjectMetadataCleanupRequest(
        deletion_id="delete-mock",
        project_id=project_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        requester_digest="e" * 64,
    )

    first = await cleaner.delete_project(request)
    second = await cleaner.delete_project(request)

    assert first == second
    assert first.deleted_documents == 1
    assert [document.document_id for document in cleaner.documents] == ["other"]
    assert workspace_id not in repr(cleaner.audits)
    assert channel_id not in repr(cleaner.audits)
