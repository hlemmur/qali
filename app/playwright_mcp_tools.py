from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.playwright_mcp_client import McpStdioTransport

PLAYWRIGHT_MCP_ALLOWED_TOOLS = (
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_wait_for",
    "browser_console_messages",
    "browser_network_requests",
    "browser_take_screenshot",
)
_REQUIRED_TOOL_INPUT_TYPES = {
    "browser_navigate": {"url": "string"},
    "browser_snapshot": {},
    "browser_click": {"target": "string"},
    "browser_type": {"target": "string", "text": "string"},
    "browser_wait_for": {"text": "string", "textGone": "string"},
    "browser_console_messages": {"level": "string", "all": "boolean"},
    "browser_network_requests": {"static": "boolean"},
    "browser_take_screenshot": {"scale": "string"},
}


class _ToolDefinition(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=4_000)
    input_schema: dict[str, object] = Field(alias="inputSchema")


class _ListToolsResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    tools: tuple[_ToolDefinition, ...] = Field(max_length=100)


class _ListToolsResponse(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    jsonrpc: Literal["2.0"]
    id: int
    result: _ListToolsResult


class _TextContent(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    type: Literal["text"]
    text: str = Field(max_length=200_000)


class _CallToolResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    content: tuple[_TextContent, ...] = Field(min_length=1, max_length=20)
    is_error: bool = Field(default=False, alias="isError")


class _CallToolResponse(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    jsonrpc: Literal["2.0"]
    id: int
    result: _CallToolResult


@dataclass(frozen=True)
class PlaywrightMcpToolResult:
    tool_name: str
    text_blocks: tuple[str, ...]


class PlaywrightMcpToolContractError(RuntimeError):
    pass


class PlaywrightMcpToolExecutionError(RuntimeError):
    pass


class PlaywrightMcpToolClient:
    def __init__(
        self,
        *,
        transport: McpStdioTransport,
        timeout_seconds: float = 5,
        max_response_bytes: int = 256 * 1024,
    ) -> None:
        if not 0 < timeout_seconds <= 30:
            raise ValueError("MCP tool timeout must be between 0 and 30 seconds")
        if not 2_048 <= max_response_bytes <= 1024 * 1024:
            raise ValueError(
                "MCP tool response limit must be between 2048 and 1048576 bytes"
            )
        self._transport = transport
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes
        self._discovered = False
        self._next_request_id = 2

    async def discover(self) -> tuple[str, ...]:
        if self._discovered:
            return PLAYWRIGHT_MCP_ALLOWED_TOOLS
        request_id = self._next_request_id
        message = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/list",
        }
        self._next_request_id += 1
        await self._send(message)
        line = await self._readline()
        try:
            response = _ListToolsResponse.model_validate_json(line)
        except (UnicodeDecodeError, ValidationError, ValueError):
            raise PlaywrightMcpToolContractError(
                "Playwright MCP invalid tool response"
            ) from None
        if response.id != request_id:
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool response correlation mismatch"
            )
        tools = response.result.tools
        names = {tool.name for tool in tools}
        if len(names) != len(tools) or any(
            tool.name in PLAYWRIGHT_MCP_ALLOWED_TOOLS
            and not _has_required_input_contract(tool)
            for tool in tools
        ):
            raise PlaywrightMcpToolContractError("Playwright MCP invalid tool contract")
        if not set(PLAYWRIGHT_MCP_ALLOWED_TOOLS).issubset(names):
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool allowlist mismatch"
            )
        self._discovered = True
        return PLAYWRIGHT_MCP_ALLOWED_TOOLS

    async def call(
        self,
        tool_name: str,
        arguments: dict[str, object],
    ) -> PlaywrightMcpToolResult:
        if not self._discovered or tool_name not in PLAYWRIGHT_MCP_ALLOWED_TOOLS:
            raise PlaywrightMcpToolContractError("Playwright MCP tool call denied")
        if not _arguments_allowed(tool_name, arguments):
            raise PlaywrightMcpToolContractError("Playwright MCP tool arguments denied")
        request_id = self._next_request_id
        self._next_request_id += 1
        await self._send(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            }
        )
        try:
            response = _CallToolResponse.model_validate_json(await self._readline())
        except (UnicodeDecodeError, ValidationError, ValueError):
            raise PlaywrightMcpToolContractError(
                "Playwright MCP invalid tool response"
            ) from None
        if response.id != request_id:
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool response correlation mismatch"
            )
        if response.result.is_error:
            raise PlaywrightMcpToolExecutionError(f"Playwright MCP {tool_name} failed")
        return PlaywrightMcpToolResult(
            tool_name=tool_name,
            text_blocks=tuple(item.text for item in response.result.content),
        )

    async def _send(self, message: dict[str, object]) -> None:
        try:
            self._transport.stdin.write(
                json.dumps(message, separators=(",", ":")).encode() + b"\n"
            )
            await self._transport.stdin.drain()
        except OSError:
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool transport unavailable"
            ) from None

    async def _readline(self) -> bytes:
        try:
            line = await asyncio.wait_for(
                self._transport.stdout.readline(), timeout=self._timeout_seconds
            )
        except TimeoutError:
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool response timed out"
            ) from None
        except ValueError:
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool response too large"
            ) from None
        except OSError:
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool transport unavailable"
            ) from None
        if len(line) > self._max_response_bytes:
            raise PlaywrightMcpToolContractError(
                "Playwright MCP tool response too large"
            )
        if not line.endswith(b"\n"):
            raise PlaywrightMcpToolContractError("Playwright MCP invalid tool response")
        return line


def _has_required_input_contract(tool: _ToolDefinition) -> bool:
    if tool.input_schema.get("type") != "object":
        return False
    properties = tool.input_schema.get("properties")
    if not isinstance(properties, dict):
        return False
    return all(
        isinstance(properties.get(field), dict)
        and properties[field].get("type") == field_type
        for field, field_type in _REQUIRED_TOOL_INPUT_TYPES[tool.name].items()
    )


def _arguments_allowed(tool_name: str, arguments: dict[str, object]) -> bool:
    if tool_name == "browser_navigate":
        return set(arguments) == {"url"} and _bounded_text(arguments["url"], 2_048)
    if tool_name == "browser_snapshot":
        return not arguments
    if tool_name == "browser_click":
        return set(arguments) == {"target"} and _bounded_text(arguments["target"], 200)
    if tool_name == "browser_type":
        return (
            set(arguments) == {"target", "text"}
            and _bounded_text(arguments["target"], 200)
            and _bounded_text(arguments["text"], 4_000, allow_empty=True)
        )
    if tool_name == "browser_wait_for":
        return set(arguments) in ({"text"}, {"textGone"}) and _bounded_text(
            next(iter(arguments.values())), 500
        )
    if tool_name == "browser_console_messages":
        return arguments == {"level": "error", "all": False}
    if tool_name == "browser_network_requests":
        return arguments == {"static": False}
    if tool_name == "browser_take_screenshot":
        return arguments == {"scale": "css"}
    return False


def _bounded_text(value: object, maximum: int, *, allow_empty: bool = False) -> bool:
    return (
        isinstance(value, str)
        and (allow_empty or bool(value))
        and len(value) <= maximum
    )


__all__ = [
    "PLAYWRIGHT_MCP_ALLOWED_TOOLS",
    "PlaywrightMcpToolClient",
    "PlaywrightMcpToolContractError",
    "PlaywrightMcpToolExecutionError",
    "PlaywrightMcpToolResult",
]
