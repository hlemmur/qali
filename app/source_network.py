from __future__ import annotations

import asyncio
import socket
import ssl
from collections.abc import Awaitable, Callable, Sequence
from ipaddress import ip_address
from typing import Any
from urllib.parse import urlsplit

from aiohttp import ClientSession, ClientTimeout, DummyCookieJar, TCPConnector
from aiohttp.abc import AbstractResolver, ResolveResult

from app.source_fetcher import SourceHttpResponse

AddressInfo = tuple[Any, Any, int, str, tuple[Any, ...]]
AddressLookup = Callable[[str, int], Awaitable[Sequence[AddressInfo]]]


async def _system_address_lookup(hostname: str, port: int) -> Sequence[AddressInfo]:
    return await asyncio.get_running_loop().getaddrinfo(
        hostname,
        port,
        family=socket.AF_UNSPEC,
        type=socket.SOCK_STREAM,
        proto=socket.IPPROTO_TCP,
    )


class SystemSourceResolver:
    def __init__(self, *, lookup: AddressLookup = _system_address_lookup) -> None:
        self._lookup = lookup

    async def resolve(self, hostname: str, port: int) -> list[str]:
        results = await self._lookup(hostname, port)
        addresses: dict[str, None] = {}
        for result in results:
            numeric_address = str(ip_address(result[4][0]))
            addresses.setdefault(numeric_address, None)
        return list(addresses)


class ApprovedAddressResolver(AbstractResolver):
    def __init__(self, *, hostname: str, addresses: tuple[str, ...]) -> None:
        self._hostname = hostname.rstrip(".").casefold()
        self._addresses = tuple(ip_address(address) for address in addresses)

    async def resolve(
        self,
        host: str,
        port: int = 0,
        family: socket.AddressFamily = socket.AF_INET,
    ) -> list[ResolveResult]:
        if host.rstrip(".").casefold() != self._hostname:
            raise OSError("source transport attempted an unapproved hostname")
        results: list[ResolveResult] = []
        for address in self._addresses:
            address_family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
            if family not in {socket.AF_UNSPEC, address_family}:
                continue
            results.append(
                ResolveResult(
                    hostname=host,
                    host=str(address),
                    port=port,
                    family=address_family,
                    proto=socket.IPPROTO_TCP,
                    flags=socket.AI_NUMERICHOST | socket.AI_NUMERICSERV,
                )
            )
        return results

    async def close(self) -> None:
        return None


class AiohttpBoundSourceTransport:
    def __init__(
        self,
        *,
        timeout_seconds: float = 30,
        ssl_context: ssl.SSLContext | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._timeout = ClientTimeout(total=timeout_seconds)
        self._ssl_context = ssl_context or ssl.create_default_context()

    async def get(
        self,
        url: str,
        *,
        approved_addresses: tuple[str, ...],
        max_bytes: int,
    ) -> SourceHttpResponse:
        parsed = urlsplit(url)
        if parsed.scheme.casefold() != "https" or parsed.hostname is None:
            raise ValueError("source transport requires an HTTPS URL")
        if not approved_addresses:
            raise ValueError("source transport requires approved addresses")
        if max_bytes <= 0:
            raise ValueError("max_bytes must be positive")
        resolver = ApprovedAddressResolver(
            hostname=parsed.hostname,
            addresses=approved_addresses,
        )
        connector = TCPConnector(
            resolver=resolver,
            ssl=self._ssl_context,
            use_dns_cache=False,
            force_close=True,
            limit=1,
        )
        async with ClientSession(
            connector=connector,
            cookie_jar=DummyCookieJar(),
            timeout=self._timeout,
            trust_env=False,
        ) as session:
            async with session.get(
                url,
                allow_redirects=False,
                headers={"Accept-Encoding": "identity"},
                server_hostname=parsed.hostname,
                ssl=self._ssl_context,
            ) as response:
                body = bytearray()
                while len(body) <= max_bytes:
                    chunk = await response.content.read(max_bytes + 1 - len(body))
                    if not chunk:
                        break
                    body.extend(chunk)
                if len(body) > max_bytes:
                    raise ValueError("source content exceeds byte limit")
                return SourceHttpResponse(
                    status_code=response.status,
                    headers=dict(response.headers.items()),
                    body=bytes(body),
                )


__all__ = [
    "AiohttpBoundSourceTransport",
    "ApprovedAddressResolver",
    "SystemSourceResolver",
]
