from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1

from app.firestore_job_repository import (
    FirestoreJobRepository,
    FirestoreJobSettings,
    create_firestore_job_repository,
)
from app.job_lifecycle import JobFailureReason, JobRetryReason, ProjectBusyError
from app.slack_ingress import OnboardProjectJob
from app.slack_progress import ProgressMessage


class _RecordingDocument:
    def __init__(self, document_id: str) -> None:
        self.document_id = document_id
        self.created_documents: list[dict[str, Any]] = []
        self.document_data: dict[str, Any] | None = None

    async def create(self, document_data: dict[str, Any]) -> None:
        self.created_documents.append(document_data)
        self.document_data = document_data.copy()

    async def get(self, *, transaction: object) -> "_Snapshot":
        del transaction
        return _Snapshot(self.document_data)


class _Snapshot:
    def __init__(self, document_data: dict[str, Any] | None) -> None:
        self.exists = document_data is not None
        self._document_data = document_data

    def to_dict(self) -> dict[str, Any] | None:
        return None if self._document_data is None else self._document_data.copy()


class _RecordingTransaction:
    def __init__(self) -> None:
        self.updates: list[dict[str, Any]] = []

    def set(
        self,
        document: _RecordingDocument,
        fields: dict[str, Any],
    ) -> None:
        document.document_data = fields.copy()

    def update(
        self,
        document: _RecordingDocument,
        fields: dict[str, Any],
    ) -> None:
        self.updates.append(fields)
        assert document.document_data is not None
        document.document_data.update(fields)

    def delete(self, document: _RecordingDocument) -> None:
        document.document_data = None


class _TransactionRunner:
    def __init__(self) -> None:
        self.transaction = _RecordingTransaction()

    async def run(
        self,
        operation: Callable[
            [_RecordingTransaction], Awaitable[OnboardProjectJob | None]
        ],
    ) -> OnboardProjectJob | None:
        return await operation(self.transaction)


class _RecordingCollection:
    def __init__(self) -> None:
        self.document_ids: list[str] = []
        self.documents: list[_RecordingDocument] = []
        self._documents_by_id: dict[str, _RecordingDocument] = {}

    def document(self, document_id: str) -> _RecordingDocument:
        self.document_ids.append(document_id)
        if existing := self._documents_by_id.get(document_id):
            return existing
        document = _RecordingDocument(document_id)
        self.documents.append(document)
        self._documents_by_id[document_id] = document
        return document


class _RecordingFirestoreClient:
    def __init__(self) -> None:
        self.collection_names: list[str] = []
        self.collection_reference = _RecordingCollection()

    def collection(self, collection_name: str) -> _RecordingCollection:
        self.collection_names.append(collection_name)
        return self.collection_reference


class _DuplicateRejectingDocument(_RecordingDocument):
    async def create(self, document_data: dict[str, Any]) -> None:
        self.created_documents.append(document_data)
        if len(self.created_documents) > 1:
            raise AlreadyExists("job already exists")


class _DuplicateRejectingCollection(_RecordingCollection):
    def __init__(self) -> None:
        super().__init__()
        self.document_reference = _DuplicateRejectingDocument("pending")

    def document(self, document_id: str) -> _RecordingDocument:
        self.document_ids.append(document_id)
        self.document_reference.document_id = document_id
        return self.document_reference


class _DuplicateRejectingFirestoreClient(_RecordingFirestoreClient):
    def __init__(self) -> None:
        super().__init__()
        self.collection_reference = _DuplicateRejectingCollection()


@pytest.mark.asyncio
async def test_create_persists_typed_pending_job_once() -> None:
    client = _RecordingFirestoreClient()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
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


@pytest.mark.asyncio
async def test_pending_job_can_be_claimed_for_processing_once() -> None:
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
        transactions=transactions,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-claim",
        source_event_id="Ev-claim",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.008000",
        request_text="<@U-QALI> onboard project Example",
    )
    await repository.create(job)

    claimed = await repository.claim(job.job_id)

    assert claimed == job
    with pytest.raises(ProjectBusyError):
        await repository.claim(job.job_id)
    assert transactions.transaction.updates == [
        {
            "status": "running",
            "started_at": firestore_v1.SERVER_TIMESTAMP,
        }
    ]


@pytest.mark.asyncio
async def test_firestore_serializes_jobs_for_one_project() -> None:
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
        transactions=transactions,
    )
    first = OnboardProjectJob(
        job_id="slack:Ev-firestore-project-first",
        source_event_id="Ev-firestore-project-first",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.023000",
        request_text="<@U-QALI> onboard project First",
    )
    second = OnboardProjectJob(
        job_id="slack:Ev-firestore-project-second",
        source_event_id="Ev-firestore-project-second",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.024000",
        request_text="<@U-QALI> onboard project Second",
    )
    await repository.create(first)
    await repository.create(second)

    assert await repository.claim(first.job_id) == first
    with pytest.raises(ProjectBusyError):
        await repository.claim(second.job_id)

    assert await repository.complete(first.job_id) is True
    assert await repository.claim(second.job_id) == second


@pytest.mark.asyncio
async def test_firestore_reclaims_running_job_after_lease_expiry() -> None:
    now = [datetime(2026, 9, 2, tzinfo=UTC)]
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
            lease_seconds=901,
        ),
        client=client,
        transactions=transactions,
        clock=lambda: now[0],
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-firestore-stale-lock",
        source_event_id="Ev-firestore-stale-lock",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.028000",
        request_text="<@U-QALI> onboard project Example",
    )
    await repository.create(job)

    assert await repository.claim(job.job_id) == job
    with pytest.raises(ProjectBusyError):
        await repository.claim(job.job_id)

    now[0] += timedelta(seconds=902)

    assert await repository.claim(job.job_id) == job


@pytest.mark.asyncio
async def test_firestore_progress_reference_survives_job_retry() -> None:
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
        transactions=transactions,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-firestore-progress-reference",
        source_event_id="Ev-firestore-progress-reference",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.033000",
        request_text="<@U-QALI> onboard project Example",
    )
    message = ProgressMessage(
        channel_id=job.channel_id,
        thread_ts=job.thread_ts,
        message_ts="1788220801.033000",
    )
    await repository.create(job)
    await repository.claim(job.job_id)

    assert await repository.attach_progress(job.job_id, message) is True
    assert (
        await repository.attach_progress(
            job.job_id,
            message.model_copy(update={"message_ts": "1788220802.033000"}),
        )
        is False
    )
    assert (
        await repository.release(job.job_id, reason=JobRetryReason.PROCESSOR_ERROR)
        is True
    )
    assert await repository.claim(job.job_id) == job

    assert await repository.get_progress(job.job_id) == message


@pytest.mark.asyncio
async def test_firestore_progress_attach_requires_project_lock_ownership() -> None:
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
        transactions=transactions,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-firestore-progress-lock",
        source_event_id="Ev-firestore-progress-lock",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.034000",
        request_text="<@U-QALI> onboard project Example",
    )
    message = ProgressMessage(
        channel_id=job.channel_id,
        thread_ts=job.thread_ts,
        message_ts="1788220801.034000",
    )
    await repository.create(job)
    await repository.claim(job.job_id)
    lock_document = next(
        document
        for document in client.collection_reference.documents
        if document.document_data is not None
        and document.document_data.get("active_job_id") == job.job_id
    )
    lock_document.document_data = {
        **lock_document.document_data,
        "active_job_id": "slack:Ev-reclaimed-by-another-job",
    }

    assert await repository.attach_progress(job.job_id, message) is False
    assert await repository.get_progress(job.job_id) is None


@pytest.mark.asyncio
async def test_running_job_can_be_completed_once() -> None:
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
        transactions=transactions,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-complete",
        source_event_id="Ev-complete",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.010000",
        request_text="<@U-QALI> onboard project Example",
    )
    await repository.create(job)
    await repository.claim(job.job_id)

    completed = await repository.complete(job.job_id)
    duplicate_completion = await repository.complete(job.job_id)

    assert completed is True
    assert duplicate_completion is False
    assert transactions.transaction.updates == [
        {
            "status": "running",
            "started_at": firestore_v1.SERVER_TIMESTAMP,
        },
        {
            "status": "completed",
            "completed_at": firestore_v1.SERVER_TIMESTAMP,
        },
    ]


@pytest.mark.asyncio
async def test_running_job_can_be_released_and_claimed_for_retry() -> None:
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
        transactions=transactions,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-retry-release",
        source_event_id="Ev-retry-release",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.011000",
        request_text="<@U-QALI> onboard project Example",
    )
    await repository.create(job)
    await repository.claim(job.job_id)

    released = await repository.release(
        job.job_id,
        reason=JobRetryReason.PROCESSOR_ERROR,
    )
    duplicate_release = await repository.release(
        job.job_id,
        reason=JobRetryReason.PROCESSOR_ERROR,
    )
    reclaimed = await repository.claim(job.job_id)

    assert released is True
    assert duplicate_release is False
    assert reclaimed == job
    assert transactions.transaction.updates == [
        {
            "status": "running",
            "started_at": firestore_v1.SERVER_TIMESTAMP,
        },
        {
            "status": "pending",
            "retry_reason": "processor_error",
            "released_at": firestore_v1.SERVER_TIMESTAMP,
            "started_at": firestore_v1.DELETE_FIELD,
        },
        {
            "status": "running",
            "started_at": firestore_v1.SERVER_TIMESTAMP,
        },
    ]


@pytest.mark.asyncio
async def test_running_job_can_be_failed_once_with_bounded_reason() -> None:
    client = _RecordingFirestoreClient()
    transactions = _TransactionRunner()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
        transactions=transactions,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-terminal-failure",
        source_event_id="Ev-terminal-failure",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.017000",
        request_text="<@U-QALI> onboard project Example",
    )
    await repository.create(job)
    await repository.claim(job.job_id)

    failed = await repository.fail(
        job.job_id,
        reason=JobFailureReason.RETRY_EXHAUSTED,
    )
    duplicate_failure = await repository.fail(
        job.job_id,
        reason=JobFailureReason.RETRY_EXHAUSTED,
    )

    assert failed is True
    assert duplicate_failure is False
    assert transactions.transaction.updates == [
        {
            "status": "running",
            "started_at": firestore_v1.SERVER_TIMESTAMP,
        },
        {
            "status": "failed",
            "failure_reason": "retry_exhausted",
            "failed_at": firestore_v1.SERVER_TIMESTAMP,
        },
    ]


@pytest.mark.asyncio
async def test_duplicate_job_creation_returns_false_without_overwrite() -> None:
    client = _DuplicateRejectingFirestoreClient()
    repository = FirestoreJobRepository(
        settings=FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        ),
        client=client,
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-duplicate",
        source_event_id="Ev-duplicate",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.002000",
        request_text="<@U-QALI> onboard project Example",
    )

    first = await repository.create(job)
    duplicate = await repository.create(job)

    assert first is True
    assert duplicate is False
    assert (
        client.collection_reference.document_ids[0]
        == (client.collection_reference.document_ids[1])
    )


@pytest.mark.asyncio
async def test_runtime_factory_uses_configured_firestore_database(
    monkeypatch: Any,
) -> None:
    client = _RecordingFirestoreClient()
    constructor_arguments: list[dict[str, str]] = []

    def create_client(**kwargs: str) -> _RecordingFirestoreClient:
        constructor_arguments.append(kwargs)
        return client

    monkeypatch.setattr(
        "app.firestore_job_repository.firestore_v1.AsyncClient",
        create_client,
    )
    repository = create_firestore_job_repository(
        FirestoreJobSettings(
            project_id="qali-507317",
            database_id="(default)",
            collection="jobs",
        )
    )
    job = OnboardProjectJob(
        job_id="slack:Ev-runtime",
        source_event_id="Ev-runtime",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788220800.003000",
        request_text="<@U-QALI> onboard project Example",
    )

    created = await repository.create(job)

    assert created is True
    assert constructor_arguments == [
        {"project": "qali-507317", "database": "(default)"}
    ]
