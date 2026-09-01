from __future__ import annotations

import hashlib
from typing import Any, Protocol

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore_v1
from pydantic import BaseModel, ConfigDict, Field

from app.slack_ingress import OnboardProjectJob


class FirestoreJobSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    collection: str = Field(default="jobs", min_length=1)


class FirestoreDocument(Protocol):
    async def create(self, document_data: dict[str, Any]) -> Any: ...


class FirestoreCollection(Protocol):
    def document(self, document_id: str) -> FirestoreDocument: ...


class FirestoreClient(Protocol):
    def collection(self, collection_name: str) -> FirestoreCollection: ...


class FirestoreJobRepository:
    def __init__(
        self,
        *,
        settings: FirestoreJobSettings,
        client: FirestoreClient,
    ) -> None:
        self._settings = settings
        self._client = client

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


def _document_id(job_id: str) -> str:
    digest = hashlib.sha256(job_id.encode()).hexdigest()
    return f"qali-job-{digest}"


__all__ = ["FirestoreJobRepository", "FirestoreJobSettings"]
