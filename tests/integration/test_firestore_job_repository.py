from typing import Any

import pytest
from google.cloud import firestore_v1

from app.firestore_job_repository import FirestoreJobRepository, FirestoreJobSettings
from app.slack_ingress import OnboardProjectJob


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


@pytest.mark.asyncio
async def test_create_persists_typed_pending_job_once() -> None:
    client = _RecordingFirestoreClient()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(collection="jobs"),
        client=client,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-001",
        source_event_id="Ev-001",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.001000",
        request_text="<@U-QALI> onboard project Example",
    )

    created = await repository.create(job)

    assert created is True
    assert client.collection_names == ["jobs"]
    assert len(client.collection_reference.document_ids) == 1
    document_id = client.collection_reference.document_ids[0]
    assert document_id.startswith("qali-job-")
    assert client.collection_reference.documents[0].created_documents == [
        {
            **job.model_dump(mode="json"),
            "status": "pending",
            "created_at": firestore_v1.SERVER_TIMESTAMP,
        }
    ]
