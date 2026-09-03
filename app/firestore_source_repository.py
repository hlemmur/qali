from __future__ import annotations

import hashlib
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


class FirestoreSourceClient(Protocol):
    def collection(self, collection_name: str) -> FirestoreSourceCollection: ...


class FirestoreSourceConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("source metadata already exists")


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
    "FirestoreSourceRepository",
    "FirestoreSourceSettings",
    "create_firestore_source_repository",
]
