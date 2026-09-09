from __future__ import annotations

from dataclasses import dataclass

import google_crc32c
import pytest

from app.secret_manager_credentials import (
    SecretManagerCredentialResolver,
    SecretManagerCredentialSettings,
)


@dataclass
class _Payload:
    data: bytes
    data_crc32c: int


@dataclass
class _Response:
    payload: _Payload


class _Client:
    def __init__(self, data: bytes = b"synthetic-password") -> None:
        self.data = data
        self.calls: list[dict[str, object]] = []

    def access_secret_version(self, **kwargs) -> _Response:
        self.calls.append(kwargs)
        return _Response(
            payload=_Payload(
                data=self.data,
                data_crc32c=google_crc32c.value(self.data),
            )
        )


class _FailingClient(_Client):
    def access_secret_version(self, **kwargs) -> _Response:
        del kwargs
        raise RuntimeError("projects/qali-507317/secrets/private-password denied")


class _CorruptClient(_Client):
    def access_secret_version(self, **kwargs) -> _Response:
        response = super().access_secret_version(**kwargs)
        response.payload.data_crc32c += 1
        return response


@pytest.mark.asyncio
async def test_resolver_reads_only_the_latest_version_in_its_configured_project() -> (
    None
):
    client = _Client()
    resolver = SecretManagerCredentialResolver(
        settings=SecretManagerCredentialSettings(
            project_id="qali-507317",
            timeout_seconds=12,
        ),
        client=client,
    )

    value = await resolver.resolve("projects/qali-507317/secrets/profile-password")

    assert value == "synthetic-password"
    assert client.calls == [
        {
            "request": {
                "name": (
                    "projects/qali-507317/secrets/profile-password/versions/latest"
                )
            },
            "timeout": 12,
        }
    ]


@pytest.mark.asyncio
async def test_resolver_redacts_provider_failures() -> None:
    resolver = SecretManagerCredentialResolver(
        settings=SecretManagerCredentialSettings(project_id="qali-507317"),
        client=_FailingClient(),
    )

    with pytest.raises(RuntimeError, match="credential value is unavailable") as exc:
        await resolver.resolve("projects/qali-507317/secrets/profile-password")

    assert "private-password" not in str(exc.value)


@pytest.mark.asyncio
async def test_resolver_rejects_cross_project_references_before_provider_access() -> (
    None
):
    client = _Client()
    resolver = SecretManagerCredentialResolver(
        settings=SecretManagerCredentialSettings(project_id="qali-507317"),
        client=client,
    )

    with pytest.raises(ValueError, match="outside the configured project"):
        await resolver.resolve("projects/other-project/secrets/profile-password")

    assert client.calls == []


@pytest.mark.asyncio
async def test_resolver_rejects_corrupt_secret_payloads() -> None:
    resolver = SecretManagerCredentialResolver(
        settings=SecretManagerCredentialSettings(project_id="qali-507317"),
        client=_CorruptClient(),
    )

    with pytest.raises(ValueError, match="integrity validation"):
        await resolver.resolve("projects/qali-507317/secrets/profile-password")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("data", "max_secret_bytes", "message"),
    (
        (b"", 64 * 1024, "integrity validation"),
        (b"four", 3, "integrity validation"),
        (b"\xff", 64 * 1024, "UTF-8 text"),
    ),
)
async def test_resolver_rejects_unusable_secret_payloads(
    data: bytes,
    max_secret_bytes: int,
    message: str,
) -> None:
    resolver = SecretManagerCredentialResolver(
        settings=SecretManagerCredentialSettings(
            project_id="qali-507317",
            max_secret_bytes=max_secret_bytes,
        ),
        client=_Client(data),
    )

    with pytest.raises(ValueError, match=message):
        await resolver.resolve("projects/qali-507317/secrets/profile-password")
