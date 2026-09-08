from __future__ import annotations

import re
from pathlib import PurePosixPath

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.browser_executor_agent import BrowserExecutionTask

PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.80"
PLAYWRIGHT_MCP_SAFE_PATH = "/usr/local/bin:/usr/bin:/bin"
_CONTEXT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,127}$")


class PlaywrightMcpSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    output_root: PurePosixPath

    @field_validator("output_root")
    @classmethod
    def require_isolated_absolute_output_root(
        cls, value: PurePosixPath
    ) -> PurePosixPath:
        if not value.is_absolute() or value == PurePosixPath("/"):
            raise ValueError("Playwright MCP output root must be an isolated path")
        return value


class PlaywrightMcpProcessSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    executable: str = Field(min_length=1, max_length=100)
    arguments: tuple[str, ...] = Field(min_length=1, max_length=50)
    environment: dict[str, str] = Field(default_factory=dict)


def build_playwright_mcp_process(
    *,
    task: BrowserExecutionTask,
    context_id: str,
    settings: PlaywrightMcpSettings,
) -> PlaywrightMcpProcessSpec:
    if _CONTEXT_ID.fullmatch(context_id) is None:
        raise ValueError("Playwright MCP context identifier is unsafe")
    output_dir = settings.output_root / context_id
    allowed_origins = ";".join(task.target_policy.allowed_origins)
    return PlaywrightMcpProcessSpec(
        executable="npx",
        arguments=(
            "--offline",
            "--yes",
            PLAYWRIGHT_MCP_PACKAGE,
            "--headless",
            "--isolated",
            "--browser",
            "chromium",
            "--codegen",
            "none",
            "--image-responses",
            "omit",
            "--block-service-workers",
            "--allowed-origins",
            allowed_origins,
            "--output-dir",
            str(output_dir),
        ),
        environment={"PATH": PLAYWRIGHT_MCP_SAFE_PATH},
    )


__all__ = [
    "PLAYWRIGHT_MCP_PACKAGE",
    "PLAYWRIGHT_MCP_SAFE_PATH",
    "PlaywrightMcpProcessSpec",
    "PlaywrightMcpSettings",
    "build_playwright_mcp_process",
]
