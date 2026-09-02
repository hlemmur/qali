from typing import Any

import pytest

from app.source_fetcher import (
    BoundedSourceFetcher,
    SourceHttpResponse,
)
from app.source_url_policy import SourceUrlPolicy


class _RecordingResolver:
    def __init__(self, addresses: list[str]) -> None:
        self._addresses = addresses
        self.requests: list[tuple[str, int]] = []

    async def resolve(self, hostname: str, port: int) -> list[str]:
        self.requests.append((hostname, port))
        return self._addresses.copy()


class _RecordingBoundTransport:
    def __init__(
        self,
        response: SourceHttpResponse | list[SourceHttpResponse],
    ) -> None:
        self._responses = response if isinstance(response, list) else [response]
        self.requests: list[dict[str, Any]] = []

    async def get(
        self,
        url: str,
        *,
        approved_addresses: tuple[str, ...],
        max_bytes: int,
    ) -> SourceHttpResponse:
        self.requests.append(
            {
                "url": url,
                "approved_addresses": approved_addresses,
                "max_bytes": max_bytes,
            }
        )
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_fetcher_returns_bounded_content_from_approved_public_address() -> None:
    resolver = _RecordingResolver(["93.184.216.34"])
    transport = _RecordingBoundTransport(
        SourceHttpResponse(
            status_code=200,
            headers={"content-type": "text/html; charset=utf-8"},
            body=b"<h1>Project guide</h1>",
        )
    )
    fetcher = BoundedSourceFetcher(
        policy=SourceUrlPolicy(
            allowed_origins={"https://docs.example.test"},
        ),
        resolver=resolver,
        transport=transport,
        max_bytes=1024,
    )

    source = await fetcher.fetch("https://docs.example.test/guide")

    assert source.url == "https://docs.example.test/guide"
    assert source.content_type == "text/html"
    assert source.content == b"<h1>Project guide</h1>"
    assert resolver.requests == [("docs.example.test", 443)]
    assert transport.requests == [
        {
            "url": "https://docs.example.test/guide",
            "approved_addresses": ("93.184.216.34",),
            "max_bytes": 1024,
        }
    ]


@pytest.mark.asyncio
async def test_fetcher_revalidates_redirect_before_following_it() -> None:
    resolver = _RecordingResolver(["93.184.216.34"])
    transport = _RecordingBoundTransport(
        SourceHttpResponse(
            status_code=302,
            headers={"location": "https://unapproved.example.test/internal"},
            body=b"",
        )
    )
    fetcher = BoundedSourceFetcher(
        policy=SourceUrlPolicy(
            allowed_origins={"https://docs.example.test"},
        ),
        resolver=resolver,
        transport=transport,
        max_bytes=1024,
    )

    with pytest.raises(ValueError, match="approved"):
        await fetcher.fetch("https://docs.example.test/guide")

    assert resolver.requests == [("docs.example.test", 443)]
    assert len(transport.requests) == 1


@pytest.mark.asyncio
async def test_fetcher_resolves_and_revalidates_each_approved_redirect() -> None:
    resolver = _RecordingResolver(["93.184.216.34"])
    transport = _RecordingBoundTransport(
        [
            SourceHttpResponse(
                status_code=302,
                headers={"Location": "https://cdn.example.test/project.txt"},
                body=b"",
            ),
            SourceHttpResponse(
                status_code=200,
                headers={"Content-Type": "text/plain; charset=utf-8"},
                body=b"Project guide",
            ),
        ]
    )
    fetcher = BoundedSourceFetcher(
        policy=SourceUrlPolicy(
            allowed_origins={
                "https://docs.example.test",
                "https://cdn.example.test",
            },
        ),
        resolver=resolver,
        transport=transport,
        max_bytes=1024,
    )

    source = await fetcher.fetch("https://docs.example.test/guide")

    assert source.url == "https://cdn.example.test/project.txt"
    assert source.content_type == "text/plain"
    assert source.content == b"Project guide"
    assert resolver.requests == [
        ("docs.example.test", 443),
        ("cdn.example.test", 443),
    ]
    assert len(transport.requests) == 2


@pytest.mark.asyncio
async def test_fetcher_fails_closed_when_hostname_has_no_addresses() -> None:
    resolver = _RecordingResolver([])
    transport = _RecordingBoundTransport(
        SourceHttpResponse(
            status_code=200,
            headers={"content-type": "text/plain"},
            body=b"Project guide",
        )
    )
    fetcher = BoundedSourceFetcher(
        policy=SourceUrlPolicy(
            allowed_origins={"https://docs.example.test"},
        ),
        resolver=resolver,
        transport=transport,
        max_bytes=1024,
    )

    with pytest.raises(ValueError, match="resolve"):
        await fetcher.fetch("https://docs.example.test/guide")

    assert transport.requests == []


@pytest.mark.asyncio
async def test_fetcher_rejects_unsupported_source_content_type() -> None:
    resolver = _RecordingResolver(["93.184.216.34"])
    transport = _RecordingBoundTransport(
        SourceHttpResponse(
            status_code=200,
            headers={"content-type": "application/octet-stream"},
            body=b"not an approved source document",
        )
    )
    fetcher = BoundedSourceFetcher(
        policy=SourceUrlPolicy(
            allowed_origins={"https://docs.example.test"},
        ),
        resolver=resolver,
        transport=transport,
        max_bytes=1024,
    )

    with pytest.raises(ValueError, match="content type"):
        await fetcher.fetch("https://docs.example.test/archive.bin")


@pytest.mark.asyncio
async def test_fetcher_rejects_transport_response_over_byte_limit() -> None:
    resolver = _RecordingResolver(["93.184.216.34"])
    transport = _RecordingBoundTransport(
        SourceHttpResponse(
            status_code=200,
            headers={"content-type": "text/plain"},
            body=b"12345",
        )
    )
    fetcher = BoundedSourceFetcher(
        policy=SourceUrlPolicy(
            allowed_origins={"https://docs.example.test"},
        ),
        resolver=resolver,
        transport=transport,
        max_bytes=4,
    )

    with pytest.raises(ValueError, match="byte limit"):
        await fetcher.fetch("https://docs.example.test/project.txt")
