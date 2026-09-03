from __future__ import annotations

import hashlib
from typing import Any, Protocol

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1
from pydantic import BaseModel, ConfigDict, Field


class FirestoreProjectSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    gcp_project_id: str = Field(min_length=1)
    database_id: str = Field(min_length=1)
    collection: str = Field(default="projects", min_length=1)


class ProjectChannelBinding(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)
    channel_id: str = Field(min_length=1)
    created_by: str = Field(min_length=1)


class FirestoreProjectDocument(Protocol):
    async def create(self, document_data: dict[str, Any]) -> Any: ...

    async def get(self) -> FirestoreProjectSnapshot: ...


class FirestoreProjectSnapshot(Protocol):
    exists: bool

    def to_dict(self) -> dict[str, Any] | None: ...


class FirestoreProjectCollection(Protocol):
    def document(self, document_id: str) -> FirestoreProjectDocument: ...


class FirestoreProjectClient(Protocol):
    def collection(self, collection_name: str) -> FirestoreProjectCollection: ...


class FirestoreProjectConflict(RuntimeError):
    def __init__(self) -> None:
        super().__init__("project channel mapping already exists")


class FirestoreProjectRepository:
    def __init__(
        self,
        *,
        settings: FirestoreProjectSettings,
        client: FirestoreProjectClient,
    ) -> None:
        self._settings = settings
        self._client = client

    async def resolve_or_create(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        created_by: str,
    ) -> ProjectChannelBinding:
        binding = ProjectChannelBinding(
            project_id=_project_id(workspace_id, channel_id),
            workspace_id=workspace_id,
            channel_id=channel_id,
            created_by=created_by,
        )
        document = self._client.collection(self._settings.collection).document(
            _document_id(workspace_id, channel_id)
        )
        try:
            await document.create(
                {
                    **binding.model_dump(mode="python"),
                    "created_at": firestore_v1.SERVER_TIMESTAMP,
                }
            )
        except AlreadyExists:
            snapshot = await document.get()
            data = snapshot.to_dict()
            if not snapshot.exists or data is None:
                raise FirestoreProjectConflict from None
            data.pop("created_at", None)
            try:
                existing = ProjectChannelBinding.model_validate(data)
            except ValueError:
                raise FirestoreProjectConflict from None
            if (
                existing.project_id != binding.project_id
                or existing.workspace_id != binding.workspace_id
                or existing.channel_id != binding.channel_id
            ):
                raise FirestoreProjectConflict from None
            return existing
        return binding


def create_firestore_project_repository(
    settings: FirestoreProjectSettings,
) -> FirestoreProjectRepository:
    client = firestore_v1.AsyncClient(
        project=settings.gcp_project_id,
        database=settings.database_id,
    )
    return FirestoreProjectRepository(settings=settings, client=client)


def _scope_digest(workspace_id: str, channel_id: str) -> str:
    return hashlib.sha256(f"{workspace_id}\0{channel_id}".encode()).hexdigest()


def _project_id(workspace_id: str, channel_id: str) -> str:
    return f"slack-project-{_scope_digest(workspace_id, channel_id)[:32]}"


def _document_id(workspace_id: str, channel_id: str) -> str:
    return f"qali-project-channel-{_scope_digest(workspace_id, channel_id)[:40]}"


__all__ = [
    "FirestoreProjectConflict",
    "FirestoreProjectRepository",
    "FirestoreProjectSettings",
    "ProjectChannelBinding",
    "create_firestore_project_repository",
]
