from __future__ import annotations

from pathlib import PurePosixPath

import pytest
from pydantic import ValidationError

from app.playwright_mcp_process import (
    PLAYWRIGHT_MCP_PACKAGE,
    PLAYWRIGHT_MCP_SAFE_PATH,
    PlaywrightMcpSettings,
    build_playwright_mcp_process,
)
from tests.integration.test_browser_executor_agent import _execution_task


def test_process_spec_pins_an_isolated_headless_browser_context() -> None:
    task = _execution_task()
    spec = build_playwright_mcp_process(
        task=task,
        context_id="context-cart-001",
        settings=PlaywrightMcpSettings(output_root=PurePosixPath("/tmp/qali-browser")),
    )

    assert PLAYWRIGHT_MCP_PACKAGE == "@playwright/mcp@0.0.80"
    assert spec.executable == "npx"
    assert spec.arguments == (
        "--offline",
        "--yes",
        PLAYWRIGHT_MCP_PACKAGE,
        "--headless",
        "--isolated",
        "--browser",
        "chromium",
        "--caps",
        "devtools",
        "--codegen",
        "none",
        "--image-responses",
        "omit",
        "--block-service-workers",
        "--allowed-origins",
        ";".join(task.target_policy.allowed_origins),
        "--output-dir",
        "/tmp/qali-browser/context-cart-001",
        "--output-max-size",
        "65000000",
    )
    assert spec.environment == {"PATH": PLAYWRIGHT_MCP_SAFE_PATH}
    assert "--allow-unrestricted-file-access" not in spec.arguments
    assert "--no-sandbox" not in spec.arguments
    assert spec.arguments[spec.arguments.index("--caps") + 1] == "devtools"


@pytest.mark.parametrize("output_root", [PurePosixPath("relative"), PurePosixPath("/")])
def test_process_spec_requires_an_isolated_absolute_output_root(output_root) -> None:
    with pytest.raises(ValidationError, match="isolated path"):
        PlaywrightMcpSettings(output_root=output_root)


def test_process_spec_rejects_unsafe_context_before_building_an_output_path() -> None:
    with pytest.raises(ValueError, match="identifier is unsafe"):
        build_playwright_mcp_process(
            task=_execution_task(),
            context_id="../shared",
            settings=PlaywrightMcpSettings(
                output_root=PurePosixPath("/tmp/qali-browser")
            ),
        )
