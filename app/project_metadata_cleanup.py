from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.project_identity import project_id_for_channel


class ProjectMetadataCleanupSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    gcp_project_id: str = Field(min_length=1)
    database_id: str = Field(min_length=1)
    projects_collection: str = Field(default="projects", min_length=1)
    sources_collection: str = Field(default="sources", min_length=1)
    jobs_collection: str = Field(default="jobs", min_length=1)
    locks_collection: str = Field(default="job_locks", min_length=1)
    audit_collection: str = Field(default="deletion_audit", min_length=1)
    audit_retention_days: int = Field(default=90, ge=1, le=365)
    max_documents_per_cleanup: int = Field(default=1_000, ge=1, le=10_000)


class ProjectMetadataCleanupRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    deletion_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,127}$")
    project_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,127}$")
    workspace_id: str = Field(min_length=1, max_length=128)
    channel_id: str = Field(min_length=1, max_length=128)
    requester_digest: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def require_matching_project_scope(self) -> ProjectMetadataCleanupRequest:
        if (
            project_id_for_channel(self.workspace_id, self.channel_id)
            != self.project_id
        ):
            raise ValueError("project_id does not match the workspace/channel scope")
        return self


class ProjectMetadataCleanupResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    deletion_id: str
    project_id: str
    deleted_documents: int = Field(ge=0)
    audit_expires_at: datetime


class InMemoryProjectMetadataDocument(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    collection: Literal["projects", "sources", "jobs", "job_locks"]
    document_id: str = Field(min_length=1)
    data: dict[str, Any]


class CleanupDocument(Protocol):
    id: str
    path: str

    async def create(self, document_data: dict[str, Any]) -> Any: ...

    async def get(self) -> CleanupSnapshot: ...

    async def update(self, fields: dict[str, Any]) -> Any: ...

    async def delete(self) -> Any: ...


class CleanupSnapshot(Protocol):
    exists: bool
    reference: CleanupDocument

    def to_dict(self) -> dict[str, Any] | None: ...


class CleanupQuery(Protocol):
    def stream(self) -> AsyncIterator[CleanupSnapshot]: ...


class CleanupCollection(Protocol):
    def document(self, document_id: str) -> CleanupDocument: ...

    def where(self, *, filter: Any) -> CleanupQuery: ...


class CleanupFirestoreClient(Protocol):
    def collection(self, collection_name: str) -> CleanupCollection: ...


class ProjectMetadataCleanupIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project metadata cleanup failed integrity checks")


class ProjectMetadataCleanupLimitExceeded(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project metadata cleanup operation limit exceeded")


class InMemoryProjectMetadataCleaner:
    def __init__(
        self,
        *,
        documents: tuple[InMemoryProjectMetadataDocument, ...] = (),
        audit_retention_days: int = 90,
        max_documents_per_cleanup: int = 1_000,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._documents = {
            (document.collection, document.document_id): document
            for document in documents
        }
        if len(self._documents) != len(documents):
            raise ValueError("in-memory metadata documents must have unique paths")
        self._audits: dict[str, dict[str, Any]] = {}
        self._audit_retention_days = audit_retention_days
        self._max_documents_per_cleanup = max_documents_per_cleanup
        self._clock = clock or _utc_now
        self._lock = asyncio.Lock()

    @property
    def documents(self) -> tuple[InMemoryProjectMetadataDocument, ...]:
        return tuple(self._documents[key] for key in sorted(self._documents))

    @property
    def audits(self) -> tuple[dict[str, Any], ...]:
        return tuple(dict(self._audits[key]) for key in sorted(self._audits))

    async def delete_project(
        self,
        request: ProjectMetadataCleanupRequest,
    ) -> ProjectMetadataCleanupResult:
        async with self._lock:
            selected = tuple(
                document
                for document in self.documents
                if _in_memory_document_matches(document, request)
            )
            if len(selected) > self._max_documents_per_cleanup:
                raise ProjectMetadataCleanupLimitExceeded

            audit_id = _audit_document_id(request.deletion_id)
            existing = self._audits.get(audit_id)
            if existing is not None:
                status, planned, expires_at = _validate_audit(existing, request)
                if status == "completed":
                    return _cleanup_result(request, planned, expires_at)
                if len(selected) > planned:
                    raise ProjectMetadataCleanupIntegrityError
            else:
                now = _aware_utc(self._clock())
                expires_at = now + timedelta(days=self._audit_retention_days)
                planned = len(selected)
                self._audits[audit_id] = _pending_audit(
                    request=request,
                    requested_at=now,
                    expires_at=expires_at,
                    planned_documents=planned,
                )

            for document in selected:
                self._documents.pop((document.collection, document.document_id))
            self._audits[audit_id].update(
                {
                    "status": "completed",
                    "completed_at": _aware_utc(self._clock()),
                    "deleted_documents": planned,
                }
            )
            return _cleanup_result(request, planned, expires_at)


class FirestoreProjectMetadataCleaner:
    def __init__(
        self,
        *,
        settings: ProjectMetadataCleanupSettings,
        client: CleanupFirestoreClient,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        self._clock = clock or _utc_now

    @staticmethod
    def lock_document_id(workspace_id: str, channel_id: str) -> str:
        scope = f"{workspace_id}\0{channel_id}"
        digest = hashlib.sha256(scope.encode()).hexdigest()
        return f"qali-project-lock-{digest}"

    async def delete_project(
        self,
        request: ProjectMetadataCleanupRequest,
    ) -> ProjectMetadataCleanupResult:
        documents = await self._collect_documents(request)
        if len(documents) > self._settings.max_documents_per_cleanup:
            raise ProjectMetadataCleanupLimitExceeded

        audit = self._client.collection(self._settings.audit_collection).document(
            _audit_document_id(request.deletion_id)
        )
        now = _aware_utc(self._clock())
        expires_at = now + timedelta(days=self._settings.audit_retention_days)
        planned_documents = len(documents)
        try:
            await audit.create(
                _pending_audit(
                    request=request,
                    requested_at=now,
                    expires_at=expires_at,
                    planned_documents=planned_documents,
                )
            )
        except AlreadyExists:
            snapshot = await audit.get()
            existing = _snapshot_data(snapshot)
            status, planned_documents, expires_at = _validate_audit(existing, request)
            if status == "completed":
                return _cleanup_result(request, planned_documents, expires_at)
            if len(documents) > planned_documents:
                raise ProjectMetadataCleanupIntegrityError from None

        for document in documents:
            await document.delete()
        await audit.update(
            {
                "status": "completed",
                "completed_at": _aware_utc(self._clock()),
                "deleted_documents": planned_documents,
            }
        )
        return _cleanup_result(request, planned_documents, expires_at)

    async def _collect_documents(
        self,
        request: ProjectMetadataCleanupRequest,
    ) -> tuple[CleanupDocument, ...]:
        documents: list[CleanupDocument] = []
        documents.extend(
            await self._query_exact(
                collection=self._settings.projects_collection,
                field="project_id",
                value=request.project_id,
            )
        )
        documents.extend(
            await self._query_exact(
                collection=self._settings.sources_collection,
                field="project_id",
                value=request.project_id,
            )
        )
        job_query = self._client.collection(self._settings.jobs_collection).where(
            filter=firestore_v1.FieldFilter("workspace_id", "==", request.workspace_id)
        )
        async for snapshot in job_query.stream():
            data = _snapshot_data(snapshot)
            if data.get("workspace_id") != request.workspace_id:
                raise ProjectMetadataCleanupIntegrityError
            channel_id = data.get("channel_id")
            if not isinstance(channel_id, str):
                raise ProjectMetadataCleanupIntegrityError
            if channel_id == request.channel_id:
                documents.append(snapshot.reference)

        lock = self._client.collection(self._settings.locks_collection).document(
            self.lock_document_id(request.workspace_id, request.channel_id)
        )
        lock_snapshot = await lock.get()
        if lock_snapshot.exists:
            if lock_snapshot.to_dict() is None:
                raise ProjectMetadataCleanupIntegrityError
            documents.append(lock)

        if len({document.path for document in documents}) != len(documents):
            raise ProjectMetadataCleanupIntegrityError
        return tuple(documents)

    async def _query_exact(
        self,
        *,
        collection: str,
        field: str,
        value: str,
    ) -> tuple[CleanupDocument, ...]:
        query = self._client.collection(collection).where(
            filter=firestore_v1.FieldFilter(field, "==", value)
        )
        documents = []
        async for snapshot in query.stream():
            data = _snapshot_data(snapshot)
            if data.get(field) != value:
                raise ProjectMetadataCleanupIntegrityError
            documents.append(snapshot.reference)
        return tuple(documents)


def create_firestore_project_metadata_cleaner(
    settings: ProjectMetadataCleanupSettings,
) -> FirestoreProjectMetadataCleaner:
    client = firestore_v1.AsyncClient(
        project=settings.gcp_project_id,
        database=settings.database_id,
    )
    return FirestoreProjectMetadataCleaner(settings=settings, client=client)


def _snapshot_data(snapshot: CleanupSnapshot) -> dict[str, Any]:
    data = snapshot.to_dict()
    if not snapshot.exists or data is None:
        raise ProjectMetadataCleanupIntegrityError
    return data


def _audit_document_id(deletion_id: str) -> str:
    digest = hashlib.sha256(deletion_id.encode()).hexdigest()
    return f"qali-deletion-{digest}"


def _pending_audit(
    *,
    request: ProjectMetadataCleanupRequest,
    requested_at: datetime,
    expires_at: datetime,
    planned_documents: int,
) -> dict[str, Any]:
    return {
        "deletion_id": request.deletion_id,
        "project_id": request.project_id,
        "requester_digest": request.requester_digest,
        "status": "pending",
        "requested_at": requested_at,
        "expires_at": expires_at,
        "planned_documents": planned_documents,
    }


def _validate_audit(
    data: dict[str, Any],
    request: ProjectMetadataCleanupRequest,
) -> tuple[Literal["pending", "completed"], int, datetime]:
    base_fields = {
        "deletion_id",
        "project_id",
        "requester_digest",
        "status",
        "requested_at",
        "expires_at",
        "planned_documents",
    }
    status = data.get("status")
    allowed_fields = (
        base_fields
        if status == "pending"
        else base_fields | {"completed_at", "deleted_documents"}
    )
    if (
        status not in {"pending", "completed"}
        or set(data) != allowed_fields
        or data.get("deletion_id") != request.deletion_id
        or data.get("project_id") != request.project_id
        or data.get("requester_digest") != request.requester_digest
    ):
        raise ProjectMetadataCleanupIntegrityError
    planned = data.get("planned_documents")
    expires_at = data.get("expires_at")
    if (
        not isinstance(planned, int)
        or isinstance(planned, bool)
        or planned < 0
        or not isinstance(expires_at, datetime)
    ):
        raise ProjectMetadataCleanupIntegrityError
    try:
        aware_expiry = _aware_utc(expires_at)
        _aware_utc(data["requested_at"])
        if status == "completed":
            _aware_utc(data["completed_at"])
    except (KeyError, TypeError, ValueError) as error:
        raise ProjectMetadataCleanupIntegrityError from error
    if status == "completed" and data.get("deleted_documents") != planned:
        raise ProjectMetadataCleanupIntegrityError
    return status, planned, aware_expiry


def _cleanup_result(
    request: ProjectMetadataCleanupRequest,
    deleted_documents: int,
    expires_at: datetime,
) -> ProjectMetadataCleanupResult:
    return ProjectMetadataCleanupResult(
        deletion_id=request.deletion_id,
        project_id=request.project_id,
        deleted_documents=deleted_documents,
        audit_expires_at=expires_at,
    )


def _in_memory_document_matches(
    document: InMemoryProjectMetadataDocument,
    request: ProjectMetadataCleanupRequest,
) -> bool:
    if document.collection in {"projects", "sources"}:
        return document.data.get("project_id") == request.project_id
    if document.collection == "jobs":
        return (
            document.data.get("workspace_id") == request.workspace_id
            and document.data.get("channel_id") == request.channel_id
        )
    return document.document_id == FirestoreProjectMetadataCleaner.lock_document_id(
        request.workspace_id, request.channel_id
    )


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("cleanup clock must return a timezone-aware datetime")
    return value.astimezone(UTC)


def _utc_now() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "FirestoreProjectMetadataCleaner",
    "InMemoryProjectMetadataCleaner",
    "InMemoryProjectMetadataDocument",
    "ProjectMetadataCleanupIntegrityError",
    "ProjectMetadataCleanupLimitExceeded",
    "ProjectMetadataCleanupRequest",
    "ProjectMetadataCleanupResult",
    "ProjectMetadataCleanupSettings",
    "create_firestore_project_metadata_cleaner",
]
