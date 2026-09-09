from __future__ import annotations

import asyncio
import re
from typing import Protocol

import google_crc32c
from pydantic import BaseModel, ConfigDict, Field

_SECRET_REFERENCE = re.compile(
    r"^projects/(?P<project>[a-z0-9-]+)/secrets/(?P<secret>[A-Za-z0-9_-]+)$"
)


class SecretPayload(Protocol):
    data: bytes
    data_crc32c: int


class SecretVersionResponse(Protocol):
    payload: SecretPayload


class SecretManagerClient(Protocol):
    def access_secret_version(self, **kwargs: object) -> SecretVersionResponse: ...


class SecretManagerCredentialSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str = Field(
        min_length=6,
        max_length=63,
        pattern=r"^[a-z][a-z0-9-]*[a-z0-9]$",
    )
    timeout_seconds: float = Field(default=30, gt=0, le=60)
    max_secret_bytes: int = Field(default=64 * 1024, ge=1, le=64 * 1024)


class CredentialResolutionError(RuntimeError):
    pass


class SecretManagerCredentialResolver:
    def __init__(
        self,
        *,
        settings: SecretManagerCredentialSettings,
        client: SecretManagerClient,
    ) -> None:
        self._settings = settings
        self._client = client

    async def resolve(self, secret_ref: str) -> str:
        match = _SECRET_REFERENCE.fullmatch(secret_ref)
        if match is None or match.group("project") != self._settings.project_id:
            raise ValueError("credential reference is outside the configured project")
        try:
            response = await asyncio.to_thread(
                self._client.access_secret_version,
                request={"name": f"{secret_ref}/versions/latest"},
                timeout=self._settings.timeout_seconds,
            )
        except Exception:
            raise CredentialResolutionError("credential value is unavailable") from None
        data = response.payload.data
        if (
            not data
            or len(data) > self._settings.max_secret_bytes
            or google_crc32c.value(data) != response.payload.data_crc32c
        ):
            raise ValueError("credential payload failed integrity validation")
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("credential payload must be UTF-8 text") from None


def create_secret_manager_credential_resolver(
    settings: SecretManagerCredentialSettings,
) -> SecretManagerCredentialResolver:
    from google.cloud import secretmanager

    return SecretManagerCredentialResolver(
        settings=settings,
        client=secretmanager.SecretManagerServiceClient(),
    )


__all__ = [
    "CredentialResolutionError",
    "SecretManagerCredentialResolver",
    "SecretManagerCredentialSettings",
    "create_secret_manager_credential_resolver",
]
