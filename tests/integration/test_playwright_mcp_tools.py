from __future__ import annotations

import json

import pytest

from app.playwright_mcp_tools import (
    PLAYWRIGHT_MCP_ALLOWED_TOOLS,
    PlaywrightMcpToolClient,
    PlaywrightMcpToolContractError,
    PlaywrightMcpToolExecutionError,
)


class _WriterDouble:
    def __init__(self) -> None:
        self.messages: list[bytes] = []

    def write(self, data: bytes) -> None:
        self.messages.append(data)

    async def drain(self) -> None:
        pass


class _ReaderDouble:
    def __init__(self, *messages: dict[str, object]) -> None:
        self._lines = [
            json.dumps(message, separators=(",", ":")).encode() + b"\n"
            for message in messages
        ]

    async def readline(self) -> bytes:
        return self._lines.pop(0) if self._lines else b""


class _RawReaderDouble:
    def __init__(self, *lines: bytes) -> None:
        self._lines = list(lines)

    async def readline(self) -> bytes:
        return self._lines.pop(0) if self._lines else b""


class _TransportDouble:
    def __init__(self, *responses: dict[str, object]) -> None:
        self.stdin = _WriterDouble()
        self.stdout = _ReaderDouble(*responses)


def _tool(name: str) -> dict[str, object]:
    properties = {
        "browser_navigate": {"url": {"type": "string"}},
        "browser_snapshot": {},
        "browser_click": {"target": {"type": "string"}},
        "browser_type": {
            "target": {"type": "string"},
            "text": {"type": "string"},
        },
        "browser_wait_for": {
            "text": {"type": "string"},
            "textGone": {"type": "string"},
        },
        "browser_console_messages": {
            "level": {"type": "string"},
            "all": {"type": "boolean"},
        },
        "browser_network_requests": {"static": {"type": "boolean"}},
        "browser_take_screenshot": {"scale": {"type": "string"}},
        "browser_start_tracing": {},
        "browser_stop_tracing": {},
    }.get(name, {})
    return {
        "name": name,
        "description": f"{name} description",
        "inputSchema": {"type": "object", "properties": properties},
    }


@pytest.mark.asyncio
async def test_discovery_exposes_only_the_fixed_qali_tool_allowlist() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "tools": [
                    *(_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS),
                    _tool("browser_evaluate"),
                ]
            },
        }
    )
    client = PlaywrightMcpToolClient(transport=transport)

    discovered = await client.discover()

    assert discovered == PLAYWRIGHT_MCP_ALLOWED_TOOLS
    assert [json.loads(message) for message in transport.stdin.messages] == [
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
    ]


@pytest.mark.asyncio
async def test_successful_discovery_is_idempotent_without_another_request() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        }
    )
    client = PlaywrightMcpToolClient(transport=transport)

    first = await client.discover()
    second = await client.discover()

    assert first == second == PLAYWRIGHT_MCP_ALLOWED_TOOLS
    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
async def test_discovery_fails_closed_when_an_allowed_tool_is_missing() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS[:-1]]
            },
        }
    )

    with pytest.raises(PlaywrightMcpToolContractError, match="allowlist mismatch"):
        await PlaywrightMcpToolClient(transport=transport).discover()


@pytest.mark.asyncio
async def test_discovery_retry_accepts_the_correlated_dynamic_response_id() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS[:-1]]
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 3,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
    )
    client = PlaywrightMcpToolClient(transport=transport)

    with pytest.raises(PlaywrightMcpToolContractError, match="allowlist mismatch"):
        await client.discover()

    assert await client.discover() == PLAYWRIGHT_MCP_ALLOWED_TOOLS
    assert [json.loads(message)["id"] for message in transport.stdin.messages] == [
        2,
        3,
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "defect", ["duplicate", "non-object-schema", "missing-required-input"]
)
async def test_discovery_rejects_ambiguous_allowed_tool_contracts(defect: str) -> None:
    tools = [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]
    if defect == "duplicate":
        tools.append(_tool(PLAYWRIGHT_MCP_ALLOWED_TOOLS[0]))
    elif defect == "non-object-schema":
        tools[0]["inputSchema"] = {"type": "array"}
    else:
        tools[0]["inputSchema"] = {"type": "object", "properties": {}}
    transport = _TransportDouble(
        {"jsonrpc": "2.0", "id": 2, "result": {"tools": tools}}
    )

    with pytest.raises(PlaywrightMcpToolContractError, match="invalid tool contract"):
        await PlaywrightMcpToolClient(transport=transport).discover()


@pytest.mark.asyncio
async def test_allowed_tool_call_returns_only_bounded_text_blocks() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        {
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "content": [
                    {"type": "text", "text": "- heading 'Profile'"},
                    {"type": "text", "text": "- textbox 'Display name'"},
                ],
                "isError": False,
            },
        },
    )
    client = PlaywrightMcpToolClient(transport=transport)
    await client.discover()

    result = await client.call("browser_snapshot", {})

    assert result.tool_name == "browser_snapshot"
    assert result.text_blocks == (
        "- heading 'Profile'",
        "- textbox 'Display name'",
    )
    assert json.loads(transport.stdin.messages[1]) == {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "browser_snapshot", "arguments": {}},
    }


@pytest.mark.asyncio
async def test_tool_calls_are_denied_before_discovery_and_outside_allowlist() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        }
    )
    client = PlaywrightMcpToolClient(transport=transport)

    with pytest.raises(PlaywrightMcpToolContractError, match="tool call denied"):
        await client.call("browser_snapshot", {})
    await client.discover()
    with pytest.raises(PlaywrightMcpToolContractError, match="tool call denied"):
        await client.call("browser_evaluate", {"function": "() => document.cookie"})

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
async def test_tool_error_fails_closed_without_returning_server_text() -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        {
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "content": [{"type": "text", "text": "secret server detail"}],
                "isError": True,
            },
        },
    )
    client = PlaywrightMcpToolClient(transport=transport)
    await client.discover()

    with pytest.raises(
        PlaywrightMcpToolExecutionError, match="browser_snapshot"
    ) as exc:
        await client.call("browser_snapshot", {})

    assert "secret server detail" not in str(exc.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (b"not-json\n", "invalid tool response"),
        (
            b'{"jsonrpc":"2.0","id":4,"result":{"content":'
            b'[{"type":"text","text":"ok"}]}}\n',
            "correlation mismatch",
        ),
        (
            b'{"jsonrpc":"2.0","id":3,"result":{"content":'
            b'[{"type":"image","data":"secret","mimeType":"image/png"}]}}\n',
            "invalid tool response",
        ),
        (
            b'{"jsonrpc":"2.0","id":3,"error":{"code":-32603,"message":"secret"}}\n',
            "invalid tool response",
        ),
    ],
)
async def test_tool_call_rejects_invalid_or_untrusted_response_shapes(
    response: bytes,
    expected: str,
) -> None:
    discovery = (
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "result": {
                    "tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]
                },
            },
            separators=(",", ":"),
        ).encode()
        + b"\n"
    )
    transport = _TransportDouble()
    transport.stdout = _RawReaderDouble(discovery, response)
    client = PlaywrightMcpToolClient(transport=transport)
    await client.discover()

    with pytest.raises(PlaywrightMcpToolContractError, match=expected) as exc:
        await client.call("browser_snapshot", {})

    assert "secret" not in str(exc.value)


@pytest.mark.asyncio
async def test_tool_response_is_bounded_before_content_parsing() -> None:
    discovery = (
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "result": {
                    "tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]
                },
            },
            separators=(",", ":"),
        ).encode()
        + b"\n"
    )
    oversized = b" " * 2049 + b"\n"
    transport = _TransportDouble()
    transport.stdout = _RawReaderDouble(discovery, oversized)
    client = PlaywrightMcpToolClient(transport=transport, max_response_bytes=2048)
    await client.discover()

    with pytest.raises(PlaywrightMcpToolContractError, match="response too large"):
        await client.call("browser_snapshot", {})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "arguments"),
    [
        ("browser_snapshot", {"filename": "/tmp/escape.md"}),
        ("browser_take_screenshot", {"filename": "escape.png"}),
        ("browser_type", {"target": "input-1", "text": "ok", "submit": True}),
        ("browser_wait_for", {"time": 30}),
        ("browser_console_messages", {"level": "debug", "all": True}),
        ("browser_network_requests", {"static": True}),
        ("browser_start_tracing", {"filename": "escape.zip"}),
        ("browser_stop_tracing", {"path": "/tmp/escape.zip"}),
    ],
)
async def test_tool_call_rejects_arguments_outside_qali_contract(
    tool_name: str,
    arguments: dict[str, object],
) -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        }
    )
    client = PlaywrightMcpToolClient(transport=transport)
    await client.discover()

    with pytest.raises(PlaywrightMcpToolContractError, match="arguments denied"):
        await client.call(tool_name, arguments)

    assert len(transport.stdin.messages) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "arguments"),
    [
        ("browser_navigate", {"url": "https://app.example.test/profile"}),
        ("browser_snapshot", {}),
        ("browser_click", {"target": "button-submit"}),
        ("browser_type", {"target": "input-name", "text": "Ada"}),
        ("browser_wait_for", {"text": "Saved"}),
        ("browser_wait_for", {"textGone": "Loading"}),
        ("browser_console_messages", {"level": "error", "all": False}),
        ("browser_network_requests", {"static": False}),
        ("browser_take_screenshot", {"scale": "css"}),
        ("browser_start_tracing", {}),
        ("browser_stop_tracing", {}),
    ],
)
async def test_tool_call_accepts_only_the_minimal_qali_arguments(
    tool_name: str,
    arguments: dict[str, object],
) -> None:
    transport = _TransportDouble(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        {
            "jsonrpc": "2.0",
            "id": 3,
            "result": {"content": [{"type": "text", "text": "ok"}]},
        },
    )
    client = PlaywrightMcpToolClient(transport=transport)
    await client.discover()

    result = await client.call(tool_name, arguments)

    assert result.text_blocks == ("ok",)
