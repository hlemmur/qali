from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.playwright_mcp_client import PlaywrightMcpInitializer
from app.playwright_mcp_lifecycle import PlaywrightMcpLifecycle
from app.playwright_mcp_process import (
    PLAYWRIGHT_MCP_PACKAGE,
    PLAYWRIGHT_MCP_SAFE_PATH,
    PLAYWRIGHT_MCP_SERVER_VERSION,
    PlaywrightMcpProcessSpec,
)
from app.playwright_mcp_tools import PlaywrightMcpToolClient

_QUALIFICATION_ENV = "QALI_RUN_PLAYWRIGHT_MCP_CONTRACT"
_EXECUTABLE_PATH_ENV = "QALI_PLAYWRIGHT_MCP_EXECUTABLE_PATH"


@pytest.mark.asyncio
async def test_pinned_playwright_mcp_launches_chromium_and_matches_contract(
    tmp_path: Path,
) -> None:
    if os.getenv(_QUALIFICATION_ENV) != "1":
        pytest.skip(f"set {_QUALIFICATION_ENV}=1 to run the real-browser contract")

    arguments = [
        "--offline",
        "--yes",
        PLAYWRIGHT_MCP_PACKAGE,
        "--headless",
        "--isolated",
        "--browser",
        "chromium",
    ]
    if executable_path := os.getenv(_EXECUTABLE_PATH_ENV):
        arguments.extend(("--executable-path", executable_path))
    arguments.extend(
        (
            "--caps",
            "devtools",
            "--codegen",
            "none",
            "--image-responses",
            "omit",
            "--block-service-workers",
            "--allowed-origins",
            "https://contract.example.test",
            "--output-dir",
            str(tmp_path / "mcp-output"),
            "--output-max-size",
            "65000000",
        )
    )

    process = await PlaywrightMcpLifecycle(shutdown_timeout_seconds=10).start(
        PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=tuple(arguments),
            environment={"PATH": PLAYWRIGHT_MCP_SAFE_PATH},
        )
    )

    try:
        session = await PlaywrightMcpInitializer(timeout_seconds=30).initialize(process)
        tools = PlaywrightMcpToolClient(transport=process, timeout_seconds=30)
        await tools.discover()
        snapshot = await tools.call("browser_snapshot", {})
    finally:
        await process.close()

    assert session.server_version == PLAYWRIGHT_MCP_SERVER_VERSION
    assert any("about:blank" in block for block in snapshot.text_blocks)
