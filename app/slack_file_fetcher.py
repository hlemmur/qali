from __future__ import annotations

import hashlib
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.slack_ingress import SlackFileReference
from app.source_fetcher import FetchedSource


class SlackFilePayload(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    file_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    media_type: str = Field(min_length=1, max_length=128)
    size_bytes: int = Field(gt=0, le=5_000_000)
    content: bytes


class AuthenticatedSlackFileClient(Protocol):
    async def download(
        self,
        file_id: str,
        *,
        max_bytes: int,
    ) -> SlackFilePayload: ...


class SlackFileIntegrityError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Slack file integrity verification failed")


class BoundedSlackFileFetcher:
    def __init__(
        self,
        *,
        client: AuthenticatedSlackFileClient,
        max_bytes: int = 5_000_000,
    ) -> None:
        if not 1 <= max_bytes <= 5_000_000:
            raise ValueError("max_bytes must be between 1 and 5000000")
        self._client = client
        self._max_bytes = max_bytes

    async def fetch(self, reference: SlackFileReference) -> FetchedSource:
        if reference.size_bytes > self._max_bytes:
            raise SlackFileIntegrityError
        payload = await self._client.download(
            reference.file_id,
            max_bytes=reference.size_bytes,
        )
        if (
            payload.file_id != reference.file_id
            or payload.name != reference.name
            or payload.media_type != reference.media_type
            or payload.size_bytes != reference.size_bytes
            or len(payload.content) != payload.size_bytes
        ):
            raise SlackFileIntegrityError
        source_ref = hashlib.sha256(reference.file_id.encode()).hexdigest()
        return FetchedSource(
            url=f"slack-file://{source_ref}",
            content_type=payload.media_type,
            content=payload.content,
        )


__all__ = [
    "AuthenticatedSlackFileClient",
    "BoundedSlackFileFetcher",
    "SlackFileIntegrityError",
    "SlackFilePayload",
]
