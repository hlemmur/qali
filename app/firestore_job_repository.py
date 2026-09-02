from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable
from typing import Any, Protocol, TypeVar

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1
from pydantic import BaseModel, ConfigDict, Field

from app.job_lifecycle import JobRetryReason
from app.slack_ingress import OnboardProjectJob


class FirestoreJobSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1)
    database_id: str = Field(min_length=1)
    collection: str = Field(default="jobs", min_length=1)


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
    def update(
        self,
        document: FirestoreDocument,
        fields: dict[str, Any],
    ) -> None: ...


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
    ) -> None:
        self._settings = settings
        self._client = client
        self._transactions = transactions or _FirestoreTransactionRunner(client)

    async def create(self, job: OnboardProjectJob) -> bool:
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

    async def claim(self, job_id: str) -> OnboardProjectJob | None:
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def claim_pending(
            transaction: FirestoreTransaction,
        ) -> OnboardProjectJob | None:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if not snapshot.exists or data is None or data.get("status") != "pending":
                return None
            transaction.update(
                document,
                {
                    "status": "running",
                    "started_at": firestore_v1.SERVER_TIMESTAMP,
                },
            )
            return OnboardProjectJob.model_validate(data)

        return await self._transactions.run(claim_pending)

    async def complete(self, job_id: str) -> bool:
        document = self._client.collection(self._settings.collection).document(
            _document_id(job_id)
        )

        async def complete_running(transaction: FirestoreTransaction) -> bool:
            snapshot = await document.get(transaction=transaction)
            data = snapshot.to_dict()
            if not snapshot.exists or data is None or data.get("status") != "running":
                return False
            transaction.update(
                document,
                {
                    "status": "completed",
                    "completed_at": firestore_v1.SERVER_TIMESTAMP,
                },
            )
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
            transaction.update(
                document,
                {
                    "status": "pending",
                    "retry_reason": reason.value,
                    "released_at": firestore_v1.SERVER_TIMESTAMP,
                    "started_at": firestore_v1.DELETE_FIELD,
                },
            )
            return True

        return await self._transactions.run(release_running)


def _document_id(job_id: str) -> str:
    digest = hashlib.sha256(job_id.encode()).hexdigest()
    return f"qali-job-{digest}"


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
