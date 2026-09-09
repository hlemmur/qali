from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol, TypeVar

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1
from pydantic import BaseModel, ConfigDict, Field

from app.feature_worker_job import FeatureTestJob
from app.finding_follow_up import ExplainFindingJob
from app.job_lifecycle import JobFailureReason, JobRetryReason, ProjectBusyError
from app.slack_ingress import OnboardProjectJob
from app.slack_progress import ProgressMessage

DurableJob = OnboardProjectJob | FeatureTestJob | ExplainFindingJob


class FirestoreJobSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1)
    database_id: str = Field(min_length=1)
    collection: str = Field(default="jobs", min_length=1)
    lock_collection: str = Field(default="job_locks", min_length=1)
    lease_seconds: int = Field(default=960, gt=900, le=3_600)


class FirestoreDocument(Protocol):
    async def create(self, document_data: dict[str, Any]) -> Any: ...

    async def get(self, *, transaction: Any) -> FirestoreSnapshot: ...


class FirestoreSnapshot(Protocol):
    exists: bool

    def to_dict(self) -> dict[str, Any] | None: ...


class FirestoreCollection(Protocol):
    def document(self, document_id: str) -> FirestoreDocument: ...


class FirestoreClient(Protocol):
    def collection(self, collection_name: str) -> FirestoreCollection: ...

    def transaction(self) -> Any: ...


class FirestoreTransaction(Protocol):
    def set(
        self,
        document: FirestoreDocument,
        fields: dict[str, Any],
    ) -> None: ...

    def update(
        self,
        document: FirestoreDocument,
        fields: dict[str, Any],
    ) -> None: ...

    def delete(self, document: FirestoreDocument) -> None: ...


TransactionResult = TypeVar("TransactionResult")
TransactionOperation = Callable[[FirestoreTransaction], Awaitable[TransactionResult]]


class TransactionRunner(Protocol):
    async def run(
        self, operation: TransactionOperation[TransactionResult]
    ) -> TransactionResult: ...


class _FirestoreTransactionRunner:
    def __init__(self, client: FirestoreClient) -> None:
        self._client = client

    async def run(
        self, operation: TransactionOperation[TransactionResult]
    ) -> TransactionResult:
        transaction = self._client.transaction()
        transactional_operation = firestore_v1.async_transactional(operation)
        return await transactional_operation(transaction)


class FirestoreJobRepository:
    def __init__(
        self,
        *,
        settings: FirestoreJobSettings,
        client: FirestoreClient,
        transactions: TransactionRunner | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        self._transactions = transactions or _FirestoreTransactionRunner(client)
        self._clock = clock or _utc_now

    async def create(self, job: DurableJob) -> bool:
        document = self._client.collection(self._settings.collection).document(
            _document_id(job.job_id)
        )
        try:
            await document.create(
                {
                    **job.model_dump(mode="json"),
                    "status": "pending",
                    "created_at": firestore_v1.SERVER_TIMESTAMP,
                }
            )
        except AlreadyExists:
            return False
        return True

    async def claim(self, job_id: str) -> DurableJob | None:
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def claim_pending(
            transaction: FirestoreTransaction,
        ) -> DurableJob | None:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if not snapshot.exists or data is None:
                return None
            status = data.get("status")
            if status not in {"pending", "running"}:
                return None
            job = _job_from_data(data)
            lock_document = self._project_lock_document(job)
            lock_snapshot = await lock_document.get(transaction=transaction)
            lock_data = lock_snapshot.to_dict()
            now = self._clock()
            lease_expires_at = now + timedelta(seconds=self._settings.lease_seconds)
            if status == "running":
                if (
                    not lock_snapshot.exists
                    or lock_data is None
                    or lock_data.get("active_job_id") != job_id
                    or _lease_is_active(lock_data, now)
                ):
                    raise ProjectBusyError
                transaction.set(
                    lock_document,
                    {
                        "active_job_id": job_id,
                        "acquired_at": firestore_v1.SERVER_TIMESTAMP,
                        "lease_expires_at": lease_expires_at,
                    },
                )
                transaction.update(
                    document,
                    {"lease_recovered_at": firestore_v1.SERVER_TIMESTAMP},
                )
                return job
            if (
                lock_snapshot.exists
                and lock_data is not None
                and lock_data.get("active_job_id") != job_id
            ):
                raise ProjectBusyError
            transaction.set(
                lock_document,
                {
                    "active_job_id": job_id,
                    "acquired_at": firestore_v1.SERVER_TIMESTAMP,
                    "lease_expires_at": lease_expires_at,
                },
            )
            transaction.update(
                document,
                {
                    "status": "running",
                    "started_at": firestore_v1.SERVER_TIMESTAMP,
                },
            )
            return job

        return await self._transactions.run(claim_pending)

    async def attach_progress(
        self,
        job_id: str,
        message: ProgressMessage,
    ) -> bool:
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def attach_to_running(transaction: FirestoreTransaction) -> bool:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if (
                not snapshot.exists
                or data is None
                or data.get("status") != "running"
                or data.get("channel_id") != message.channel_id
                or data.get("thread_ts") != message.thread_ts
            ):
                return False
            job = _job_from_data(data)
            lock_document = self._project_lock_document(job)
            if not await _owns_lock(transaction, lock_document, job_id):
                return False
            existing_message_ts = data.get("progress_message_ts")
            if existing_message_ts is not None:
                return existing_message_ts == message.message_ts
            transaction.update(
                document,
                {
                    "progress_message_ts": message.message_ts,
                    "progress_attached_at": firestore_v1.SERVER_TIMESTAMP,
                },
            )
            return True

        return await self._transactions.run(attach_to_running)

    async def get_progress(self, job_id: str) -> ProgressMessage | None:
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def read_progress(
            transaction: FirestoreTransaction,
        ) -> ProgressMessage | None:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if not snapshot.exists or data is None:
                return None
            message_ts = data.get("progress_message_ts")
            if not isinstance(message_ts, str) or not message_ts:
                return None
            return ProgressMessage(
                channel_id=data["channel_id"],
                thread_ts=data["thread_ts"],
                message_ts=message_ts,
            )

        return await self._transactions.run(read_progress)

    async def complete(self, job_id: str) -> bool:
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def complete_running(transaction: FirestoreTransaction) -> bool:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if not snapshot.exists or data is None or data.get("status") != "running":
                return False
            job = _job_from_data(data)
            lock_document = self._project_lock_document(job)
            if not await _owns_lock(transaction, lock_document, job_id):
                return False
            transaction.update(
                document,
                {
                    "status": "completed",
                    "completed_at": firestore_v1.SERVER_TIMESTAMP,
                },
            )
            transaction.delete(lock_document)
            return True

        return await self._transactions.run(complete_running)

    async def release(self, job_id: str, *, reason: JobRetryReason) -> bool:
        reason = JobRetryReason(reason)
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def release_running(transaction: FirestoreTransaction) -> bool:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if not snapshot.exists or data is None or data.get("status") != "running":
                return False
            job = _job_from_data(data)
            lock_document = self._project_lock_document(job)
            if not await _owns_lock(transaction, lock_document, job_id):
                return False
            transaction.update(
                document,
                {
                    "status": "pending",
                    "retry_reason": reason.value,
                    "released_at": firestore_v1.SERVER_TIMESTAMP,
                    "started_at": firestore_v1.DELETE_FIELD,
                },
            )
            transaction.delete(lock_document)
            return True

        return await self._transactions.run(release_running)

    async def fail(self, job_id: str, *, reason: JobFailureReason) -> bool:
        reason = JobFailureReason(reason)
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def fail_running(transaction: FirestoreTransaction) -> bool:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if not snapshot.exists or data is None or data.get("status") != "running":
                return False
            job = _job_from_data(data)
            lock_document = self._project_lock_document(job)
            if not await _owns_lock(transaction, lock_document, job_id):
                return False
            transaction.update(
                document,
                {
                    "status": "failed",
                    "failure_reason": reason.value,
                    "failed_at": firestore_v1.SERVER_TIMESTAMP,
                },
            )
            transaction.delete(lock_document)
            return True

        return await self._transactions.run(fail_running)

    def _project_lock_document(self, job: DurableJob) -> FirestoreDocument:
        return self._client.collection(self._settings.lock_collection).document(
            _project_lock_id(job)
        )


async def _owns_lock(
    transaction: FirestoreTransaction,
    lock_document: FirestoreDocument,
    job_id: str,
) -> bool:
    snapshot = await lock_document.get(transaction=transaction)
    data = snapshot.to_dict()
    return snapshot.exists and data is not None and data.get("active_job_id") == job_id


def _document_id(job_id: str) -> str:
    digest = hashlib.sha256(job_id.encode()).hexdigest()
    return f"qali-job-{digest}"


def _project_lock_id(job: DurableJob) -> str:
    scope = f"{job.workspace_id}\0{job.channel_id}"
    digest = hashlib.sha256(scope.encode()).hexdigest()
    return f"qali-project-lock-{digest}"


def _lease_is_active(lock_data: dict[str, Any], now: datetime) -> bool:
    lease_expires_at = lock_data.get("lease_expires_at")
    return not isinstance(lease_expires_at, datetime) or now < lease_expires_at


def _job_from_data(data: dict[str, Any]) -> DurableJob:
    kind = data.get("kind")
    if kind == "onboard_project":
        return OnboardProjectJob.model_validate(data)
    if kind == "test_feature":
        payload = {
            name: data[name] for name in FeatureTestJob.model_fields if name in data
        }
        return FeatureTestJob.model_validate(payload)
    if kind == "explain_finding":
        payload = {
            name: data[name] for name in ExplainFindingJob.model_fields if name in data
        }
        return ExplainFindingJob.model_validate(payload)
    raise ValueError("unsupported durable job kind")


def _utc_now() -> datetime:
    return datetime.now(UTC)


def create_firestore_job_repository(
    settings: FirestoreJobSettings,
) -> FirestoreJobRepository:
    return FirestoreJobRepository(
        settings=settings,
        client=firestore_v1.AsyncClient(
            project=settings.project_id,
            database=settings.database_id,
        ),
    )


__all__ = [
    "FirestoreJobRepository",
    "FirestoreJobSettings",
    "create_firestore_job_repository",
]
