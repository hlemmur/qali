from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.playwright_mcp_process import PLAYWRIGHT_MCP_SERVER_VERSION

MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_STDIO_LIMIT_BYTES = 1024 * 1024


class McpWriter(Protocol):
    def write(self, data: bytes) -> None: ...

    async def drain(self) -> None: ...


class McpReader(Protocol):
    async def readline(self) -> bytes: ...


class McpStdioTransport(Protocol):
    stdin: McpWriter
    stdout: McpReader


@dataclass(frozen=True)
class PlaywrightMcpSession:
    protocol_version: str
    server_name: str
    server_version: str


class PlaywrightMcpProtocolError(RuntimeError):
    pass


class _ServerInfo(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    name: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=100)


class _ServerCapabilities(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    tools: dict[str, object] | None = None


class _InitializeResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    protocol_version: str = Field(alias="protocolVersion", min_length=1, max_length=30)
    capabilities: _ServerCapabilities
    server_info: _ServerInfo = Field(alias="serverInfo")


class _InitializeResponse(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    jsonrpc: Literal["2.0"]
    id: Literal[1]
    result: _InitializeResult


class PlaywrightMcpInitializer:
    def __init__(
        self,
        *,
        timeout_seconds: float = 5,
        max_response_bytes: int = 64 * 1024,
    ) -> None:
        if not 0 < timeout_seconds <= 30:
            raise ValueError("MCP initialize timeout must be between 0 and 30 seconds")
        if not 128 <= max_response_bytes <= 64 * 1024:
            raise ValueError(
                "MCP initialize response limit must be between 128 and 65536 bytes"
            )
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes

    async def initialize(self, transport: McpStdioTransport) -> PlaywrightMcpSession:
        await self._send(
            transport.stdin,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "qali", "version": "0.1.0"},
                },
            },
        )
        try:
            line = await asyncio.wait_for(
                transport.stdout.readline(), timeout=self._timeout_seconds
            )
        except TimeoutError:
            raise PlaywrightMcpProtocolError(
                "Playwright MCP initialize timed out"
            ) from None
        except ValueError:
            raise PlaywrightMcpProtocolError(
                "Playwright MCP initialize response too large"
            ) from None
        except OSError:
            raise PlaywrightMcpProtocolError(
                "Playwright MCP transport unavailable"
            ) from None
        if len(line) > self._max_response_bytes:
            raise PlaywrightMcpProtocolError(
                "Playwright MCP initialize response too large"
            )
        try:
            if not line.endswith(b"\n"):
                raise ValueError
            response = _InitializeResponse.model_validate_json(line)
        except (UnicodeDecodeError, ValidationError, ValueError):
            raise PlaywrightMcpProtocolError(
                "Playwright MCP invalid initialize response"
            ) from None
        result = response.result
        if result.protocol_version != MCP_PROTOCOL_VERSION:
            raise PlaywrightMcpProtocolError("Playwright MCP protocol mismatch")
        if result.capabilities.tools is None:
            raise PlaywrightMcpProtocolError("Playwright MCP tools unavailable")
        if result.server_info.version != PLAYWRIGHT_MCP_SERVER_VERSION:
            raise PlaywrightMcpProtocolError("Playwright MCP server version mismatch")
        await self._send(
            transport.stdin,
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        return PlaywrightMcpSession(
            protocol_version=result.protocol_version,
            server_name=result.server_info.name,
            server_version=result.server_info.version,
        )

    async def _send(self, writer: McpWriter, message: dict[str, object]) -> None:
        try:
            writer.write(
                json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
            )
            await writer.drain()
        except OSError:
            raise PlaywrightMcpProtocolError(
                "Playwright MCP transport unavailable"
            ) from None


__all__ = [
    "MCP_PROTOCOL_VERSION",
    "MCP_STDIO_LIMIT_BYTES",
    "McpReader",
    "McpStdioTransport",
    "McpWriter",
    "PlaywrightMcpInitializer",
    "PlaywrightMcpProtocolError",
    "PlaywrightMcpSession",
]
