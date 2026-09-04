from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from typing import Any, Protocol

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1
from pydantic import BaseModel, ConfigDict, Field

from app.raw_source_repository import RawSourceArtifact


class FirestoreSourceSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1)
    database_id: str = Field(min_length=1)
    collection: str = Field(default="sources", min_length=1)


class FirestoreSourceDocument(Protocol):
    async def create(self, document_data: dict[str, Any]) -> Any: ...

    async def get(self) -> FirestoreSourceSnapshot: ...


class FirestoreSourceSnapshot(Protocol):
    exists: bool

    def to_dict(self) -> dict[str, Any] | None: ...


class FirestoreSourceCollection(Protocol):
    def document(self, document_id: str) -> FirestoreSourceDocument: ...

    def where(self, *, filter: Any) -> FirestoreSourceQuery: ...


class FirestoreSourceQuery(Protocol):
    def stream(self) -> AsyncIterator[FirestoreSourceSnapshot]: ...


class FirestoreSourceClient(Protocol):
    def collection(self, collection_name: str) -> FirestoreSourceCollection: ...


class FirestoreSourceConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("source metadata already exists")


class FirestoreSourceIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("source metadata integrity verification failed")


class FirestoreSourceRepository:
    def __init__(
        self,
        *,
        settings: FirestoreSourceSettings,
        client: FirestoreSourceClient,
    ) -> None:
        self._settings = settings
        self._client = client

    async def create(self, artifact: RawSourceArtifact) -> bool:
        document = self._client.collection(self._settings.collection).document(
            _document_id(artifact.project_id, artifact.source_id)
        )
        try:
            await document.create(
                {
                    **artifact.model_dump(mode="python"),
                    "indexed_at": firestore_v1.SERVER_TIMESTAMP,
                }
            )
        except AlreadyExists:
            snapshot = await document.get()
            data = snapshot.to_dict()
            if not snapshot.exists or data is None:
                raise FirestoreSourceConflict from None
            data.pop("indexed_at", None)
            try:
                existing = RawSourceArtifact.model_validate(data)
            except ValueError:
                raise FirestoreSourceConflict from None
            if existing != artifact:
                raise FirestoreSourceConflict from None
            return False
        return True

    async def list_for_project(
        self,
        project_id: str,
    ) -> tuple[RawSourceArtifact, ...]:
        query = self._client.collection(self._settings.collection).where(
            filter=firestore_v1.FieldFilter("project_id", "==", project_id)
        )
        artifacts: list[RawSourceArtifact] = []
        source_ids: set[str] = set()
        async for snapshot in query.stream():
            data = snapshot.to_dict()
            if not snapshot.exists or data is None:
                raise FirestoreSourceIntegrityError
            data.pop("indexed_at", None)
            try:
                artifact = RawSourceArtifact.model_validate(data)
            except ValueError:
                raise FirestoreSourceIntegrityError from None
            if (
                artifact.project_id != project_id
                or artifact.source_id in source_ids
                or artifact.captured_at.tzinfo is None
                or artifact.captured_at.utcoffset() is None
            ):
                raise FirestoreSourceIntegrityError
            source_ids.add(artifact.source_id)
            artifacts.append(artifact)
        return tuple(
            sorted(artifacts, key=lambda item: (item.captured_at, item.source_id))
        )


def create_firestore_source_repository(
    settings: FirestoreSourceSettings,
) -> FirestoreSourceRepository:
    client = firestore_v1.AsyncClient(
        project=settings.project_id,
        database=settings.database_id,
    )
    return FirestoreSourceRepository(settings=settings, client=client)


def _document_id(project_id: str, source_id: str) -> str:
    digest = hashlib.sha256(f"{project_id}\0{source_id}".encode()).hexdigest()
    return f"qali-source-{digest[:40]}"


__all__ = [
    "FirestoreSourceConflict",
    "FirestoreSourceIntegrityError",
    "FirestoreSourceRepository",
    "FirestoreSourceSettings",
    "create_firestore_source_repository",
]
