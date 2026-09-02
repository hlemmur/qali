from __future__ import annotations

from typing import Protocol
from urllib.parse import urljoin, urlsplit

from pydantic import BaseModel, ConfigDict, Field

from app.source_url_policy import SourceUrlPolicy

_ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/html",
    "text/markdown",
    "text/plain",
}


class SourceHttpResponse(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    status_code: int = Field(ge=100, le=599)
    headers: dict[str, str]
    body: bytes


class FetchedSource(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    url: str
    content_type: str
    content: bytes


class SourceResolver(Protocol):
    async def resolve(self, hostname: str, port: int) -> list[str]: ...


class BoundSourceTransport(Protocol):
    async def get(
        self,
        url: str,
        *,
        approved_addresses: tuple[str, ...],
        max_bytes: int,
    ) -> SourceHttpResponse: ...


class BoundedSourceFetcher:
    def __init__(
        self,
        *,
        policy: SourceUrlPolicy,
        resolver: SourceResolver,
        transport: BoundSourceTransport,
        max_bytes: int,
        max_redirects: int = 3,
    ) -> None:
        if max_bytes <= 0:
            raise ValueError("max_bytes must be positive")
        if not 0 <= max_redirects <= 5:
            raise ValueError("max_redirects must be between zero and five")
        self._policy = policy
        self._resolver = resolver
        self._transport = transport
        self._max_bytes = max_bytes
        self._max_redirects = max_redirects

    async def fetch(self, url: str) -> FetchedSource:
        current_url = url
        for redirect_count in range(self._max_redirects + 1):
            normalized_url = self._policy.validate(current_url)
            parsed = urlsplit(normalized_url)
            assert parsed.hostname is not None
            addresses = tuple(
                await self._resolver.resolve(parsed.hostname, parsed.port or 443)
            )
            if not addresses:
                raise ValueError("source hostname did not resolve")
            normalized_url = self._policy.validate(
                normalized_url,
                resolved_addresses=addresses,
            )
            response = await self._transport.get(
                normalized_url,
                approved_addresses=addresses,
                max_bytes=self._max_bytes,
            )
            headers = {
                name.casefold(): value for name, value in response.headers.items()
            }
            if response.status_code == 200:
                if len(response.body) > self._max_bytes:
                    raise ValueError("source content exceeds byte limit")
                content_type = headers.get("content-type", "").split(";", 1)[0]
                if content_type not in _ALLOWED_CONTENT_TYPES:
                    raise ValueError("source content type is not supported")
                return FetchedSource(
                    url=normalized_url,
                    content_type=content_type,
                    content=response.body,
                )
            if response.status_code not in {301, 302, 303, 307, 308}:
                raise ValueError("source fetch did not return success")
            if redirect_count >= self._max_redirects:
                raise ValueError("source redirect limit exceeded")
            location = headers.get("location")
            if not location:
                raise ValueError("source redirect is missing location")
            current_url = urljoin(normalized_url, location)
        raise AssertionError("unreachable source redirect state")


__all__ = [
    "BoundedSourceFetcher",
    "FetchedSource",
    "SourceHttpResponse",
]
