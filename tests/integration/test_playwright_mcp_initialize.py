from __future__ import annotations

import asyncio
import json

import pytest

from app.playwright_mcp_client import (
    PlaywrightMcpInitializer,
    PlaywrightMcpProtocolError,
)


class _WriterDouble:
    def __init__(self) -> None:
        self.messages: list[bytes] = []
        self.drains = 0

    def write(self, data: bytes) -> None:
        self.messages.append(data)

    async def drain(self) -> None:
        self.drains += 1


class _BrokenWriterDouble(_WriterDouble):
    async def drain(self) -> None:
        raise BrokenPipeError("secret child path")


class _ReaderDouble:
    def __init__(self, *messages: dict[str, object]) -> None:
        self._lines = [
            json.dumps(message, separators=(",", ":")).encode() + b"\n"
            for message in messages
        ]

    async def readline(self) -> bytes:
        return self._lines.pop(0) if self._lines else b""


class _RawReaderDouble:
    def __init__(self, line: bytes) -> None:
        self._line = line

    async def readline(self) -> bytes:
        line, self._line = self._line, b""
        return line


class _HungReaderDouble:
    async def readline(self) -> bytes:
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


class _FailingReaderDouble:
    def __init__(self, error: Exception) -> None:
        self._error = error

    async def readline(self) -> bytes:
        raise self._error


class _TransportDouble:
    def __init__(self, *responses: dict[str, object]) -> None:
        self.stdin = _WriterDouble()
        self.stdout = _ReaderDouble(*responses)


@pytest.mark.asyncio
async def test_initialize_negotiates_pinned_protocol_and_enables_tools() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": "2025-11-25",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "Playwright", "version": "0.0.80"},
            },
        }
    )

    session = await PlaywrightMcpInitializer().initialize(transport)

    assert session.protocol_version == "2025-11-25"
    assert session.server_name == "Playwright"
    assert session.server_version == "0.0.80"
    assert [json.loads(message) for message in transport.stdin.messages] == [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "qali", "version": "0.1.0"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
    ]
    assert transport.stdin.drains == 2


@pytest.mark.asyncio
async def test_initialize_rejects_server_protocol_drift_before_ready_notification() -> (
    None
):
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": "2026-07-28",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "Playwright", "version": "0.0.80"},
            },
        }
    )

    with pytest.raises(PlaywrightMcpProtocolError, match="protocol mismatch"):
        await PlaywrightMcpInitializer().initialize(transport)

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
async def test_initialize_rejects_server_without_tools_capability() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "serverInfo": {"name": "Playwright", "version": "0.0.80"},
            },
        }
    )

    with pytest.raises(PlaywrightMcpProtocolError, match="tools unavailable"):
        await PlaywrightMcpInitializer().initialize(transport)

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
async def test_initialize_rejects_unpinned_server_version() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": "2025-11-25",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "Playwright", "version": "0.0.81"},
            },
        }
    )

    with pytest.raises(PlaywrightMcpProtocolError, match="server version mismatch"):
        await PlaywrightMcpInitializer().initialize(transport)

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        b"",
        b"not-json\n",
        b'{"jsonrpc":"2.0","id":2,"result":{}}\n',
        b'{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"no"}}\n',
        (
            b'{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":'
            b'"2025-11-25","capabilities":{"tools":{}},'
            b'"serverInfo":{"name":"Playwright"}}}\n'
        ),
    ],
)
async def test_initialize_rejects_invalid_responses_without_leaking_details(
    response: bytes,
) -> None:
    transport = _TransportDouble()
    transport.stdout = _RawReaderDouble(response)

    with pytest.raises(PlaywrightMcpProtocolError, match="invalid initialize response"):
        await PlaywrightMcpInitializer().initialize(transport)

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
async def test_initialize_timeout_fails_with_stable_protocol_error() -> None:
    transport = _TransportDouble()
    transport.stdout = _HungReaderDouble()

    with pytest.raises(PlaywrightMcpProtocolError, match="initialize timed out"):
        await PlaywrightMcpInitializer(timeout_seconds=0.001).initialize(transport)

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
async def test_initialize_rejects_response_over_configured_size_limit() -> None:
    transport = _TransportDouble()
    transport.stdout = _RawReaderDouble(b" " * 129 + b"\n")

    with pytest.raises(PlaywrightMcpProtocolError, match="response too large"):
        await PlaywrightMcpInitializer(max_response_bytes=128).initialize(transport)

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
async def test_initialize_reports_broken_stdio_without_os_details() -> None:
    transport = _TransportDouble()
    transport.stdin = _BrokenWriterDouble()

    with pytest.raises(
        PlaywrightMcpProtocolError, match="transport unavailable"
    ) as exc:
        await PlaywrightMcpInitializer().initialize(transport)

    assert "secret child path" not in str(exc.value)


@pytest.mark.asyncio
async def test_initialize_maps_reader_limit_failure_to_bounded_error() -> None:
    transport = _TransportDouble()
    transport.stdout = _FailingReaderDouble(ValueError("separator not found"))

    with pytest.raises(PlaywrightMcpProtocolError, match="response too large"):
        await PlaywrightMcpInitializer().initialize(transport)


@pytest.mark.asyncio
async def test_initialize_reports_broken_reader_without_os_details() -> None:
    transport = _TransportDouble()
    transport.stdout = _FailingReaderDouble(OSError("secret child path"))

    with pytest.raises(
        PlaywrightMcpProtocolError, match="transport unavailable"
    ) as exc:
        await PlaywrightMcpInitializer().initialize(transport)

    assert "secret child path" not in str(exc.value)
