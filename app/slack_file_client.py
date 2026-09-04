from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, Protocol
from urllib.parse import urlsplit

from aiohttp import ClientSession, ClientTimeout, DummyCookieJar
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from slack_sdk.web.async_client import AsyncWebClient

from app.slack_file_fetcher import SlackFilePayload


class SlackFileClientSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    token: SecretStr
    timeout_seconds: float = Field(default=30, gt=0, le=120)


class SlackMetadataClient(Protocol):
    async def files_info(self, *, file: str, **kwargs: Any) -> Any: ...


class SlackDownloadTransport(Protocol):
    async def get(
        self,
        url: str,
        *,
        bearer_token: str,
        max_bytes: int,
    ) -> bytes: ...


class SlackFileUnavailable(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Slack file is unavailable")


class AiohttpSlackDownloadTransport:
    def __init__(self, *, timeout_seconds: float = 30) -> None:
        if not 0 < timeout_seconds <= 120:
            raise ValueError("timeout_seconds must be between 0 and 120")
        self._timeout = ClientTimeout(total=timeout_seconds)

    async def get(
        self,
        url: str,
        *,
        bearer_token: str,
        max_bytes: int,
    ) -> bytes:
        _require_slack_download_url(url)
        if not bearer_token or not 1 <= max_bytes <= 5_000_000:
            raise SlackFileUnavailable
        async with ClientSession(
            cookie_jar=DummyCookieJar(),
            timeout=self._timeout,
            trust_env=False,
        ) as session:
            async with session.get(
                url,
                allow_redirects=False,
                headers={
                    "Accept-Encoding": "identity",
                    "Authorization": f"Bearer {bearer_token}",
                },
            ) as response:
                if response.status != 200:
                    raise SlackFileUnavailable
                body = bytearray()
                while len(body) <= max_bytes:
                    chunk = await response.content.read(max_bytes + 1 - len(body))
                    if not chunk:
                        break
                    body.extend(chunk)
                if len(body) > max_bytes:
                    raise SlackFileUnavailable
                return bytes(body)


class SlackApiFileClient:
    def __init__(
        self,
        *,
        settings: SlackFileClientSettings,
        metadata_client: SlackMetadataClient,
        transport: SlackDownloadTransport,
    ) -> None:
        self._settings = settings
        self._metadata_client = metadata_client
        self._transport = transport

    async def download(self, file_id: str, *, max_bytes: int) -> SlackFilePayload:
        if not file_id or not 1 <= max_bytes <= 5_000_000:
            raise SlackFileUnavailable
        try:
            response = await self._metadata_client.files_info(file=file_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            raise SlackFileUnavailable from None
        if not isinstance(response, Mapping) or response.get("ok") is not True:
            raise SlackFileUnavailable
        metadata = response.get("file")
        if not isinstance(metadata, Mapping):
            raise SlackFileUnavailable
        resolved_id = metadata.get("id")
        name = metadata.get("name")
        media_type = metadata.get("mimetype")
        size_bytes = metadata.get("size")
        download_url = metadata.get("url_private_download")
        if (
            not isinstance(resolved_id, str)
            or not isinstance(name, str)
            or not isinstance(media_type, str)
            or type(size_bytes) is not int
            or not isinstance(download_url, str)
        ):
            raise SlackFileUnavailable
        _require_slack_download_url(download_url)
        try:
            content = await self._transport.get(
                download_url,
                bearer_token=self._settings.token.get_secret_value(),
                max_bytes=max_bytes,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            raise SlackFileUnavailable from None
        if len(content) > max_bytes:
            raise SlackFileUnavailable
        return SlackFilePayload(
            file_id=resolved_id,
            name=name,
            media_type=media_type,
            size_bytes=size_bytes,
            content=content,
        )


def create_slack_api_file_client(
    settings: SlackFileClientSettings,
) -> SlackApiFileClient:
    token = settings.token.get_secret_value()
    if not token:
        raise ValueError("Slack token must not be empty")
    return SlackApiFileClient(
        settings=settings,
        metadata_client=AsyncWebClient(token=token),
        transport=AiohttpSlackDownloadTransport(
            timeout_seconds=settings.timeout_seconds,
        ),
    )


def _require_slack_download_url(url: str) -> None:
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        raise SlackFileUnavailable from None
    if (
        parsed.scheme.casefold() != "https"
        or parsed.hostname is None
        or parsed.hostname.rstrip(".").casefold() != "files.slack.com"
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
        or not parsed.path.startswith("/files-pri/")
        or parsed.fragment
    ):
        raise SlackFileUnavailable


__all__ = [
    "AiohttpSlackDownloadTransport",
    "SlackApiFileClient",
    "SlackDownloadTransport",
    "SlackFileClientSettings",
    "SlackFileUnavailable",
    "SlackMetadataClient",
    "create_slack_api_file_client",
]
