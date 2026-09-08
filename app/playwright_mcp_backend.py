from __future__ import annotations

import re

from app.browser_executor_agent import BrowserExecutionTask
from app.browser_facade import AccessibilitySnapshot, BackendObservation
from app.playwright_mcp_client import PlaywrightMcpInitializer
from app.playwright_mcp_lifecycle import ManagedMcpProcess, PlaywrightMcpLifecycle
from app.playwright_mcp_process import (
    PlaywrightMcpProcessSpec,
    PlaywrightMcpSettings,
    build_playwright_mcp_process,
)
from app.playwright_mcp_tools import PlaywrightMcpToolClient, PlaywrightMcpToolResult
from app.test_design import OracleKind

_CONSOLE_SUMMARY = re.compile(
    r"^Total messages: \d+ \(Errors: (?P<errors>\d+), Warnings: \d+\)$"
)
_NETWORK_LINE = re.compile(
    r"^\d+\. \[[A-Z]+\] \S+ => \[(?P<status>FAILED|\d{3})\](?: .*)?$"
)
_SCREENSHOT_LINK = re.compile(
    r"^- \[Screenshot of (?:viewport|full page|element)\]"
    r"\(\./(?P<filename>[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:png|jpeg|webp))\)$"
)


class PlaywrightMcpBackendError(RuntimeError):
    pass


class PlaywrightMcpBackendFactory:
    def __init__(
        self,
        *,
        settings: PlaywrightMcpSettings,
        lifecycle: PlaywrightMcpLifecycle | None = None,
        initializer: PlaywrightMcpInitializer | None = None,
    ) -> None:
        self._settings = settings
        self._lifecycle = lifecycle or PlaywrightMcpLifecycle()
        self._initializer = initializer or PlaywrightMcpInitializer()

    async def create(
        self,
        *,
        context_id: str,
        task: BrowserExecutionTask,
    ) -> PlaywrightMcpBrowserBackend:
        return PlaywrightMcpBrowserBackend(
            process_spec=build_playwright_mcp_process(
                task=task,
                context_id=context_id,
                settings=self._settings,
            ),
            lifecycle=self._lifecycle,
            initializer=self._initializer,
        )


class PlaywrightMcpBrowserBackend:
    def __init__(
        self,
        *,
        process_spec: PlaywrightMcpProcessSpec,
        lifecycle: PlaywrightMcpLifecycle | None = None,
        initializer: PlaywrightMcpInitializer | None = None,
    ) -> None:
        self._process_spec = process_spec
        self._lifecycle = lifecycle or PlaywrightMcpLifecycle()
        self._initializer = initializer or PlaywrightMcpInitializer()
        self._process: ManagedMcpProcess | None = None
        self._tools: PlaywrightMcpToolClient | None = None

    async def start(self) -> None:
        if self._process is not None:
            raise PlaywrightMcpBackendError("Playwright MCP backend is already active")
        process = await self._lifecycle.start(self._process_spec)
        try:
            await self._initializer.initialize(process)
            tools = PlaywrightMcpToolClient(transport=process)
            await tools.discover()
        except BaseException:
            await process.close()
            raise
        self._process = process
        self._tools = tools

    async def close(self) -> None:
        process, self._process = self._process, None
        self._tools = None
        if process is not None:
            await process.close()

    async def navigate(self, url: str) -> str:
        result = await self._call("browser_navigate", {"url": url})
        return _page_url(result)

    async def snapshot(self) -> AccessibilitySnapshot:
        result = await self._call("browser_snapshot", {})
        sections = _response_sections(result)
        snapshot = sections.get("Snapshot")
        if snapshot is None:
            raise PlaywrightMcpBackendError("Playwright MCP snapshot unavailable")
        return AccessibilitySnapshot(
            current_url=_page_url(result, sections=sections),
            accessibility_tree=_inline_snapshot(snapshot),
        )

    async def click(self, ref: str) -> str:
        return _page_url(await self._call("browser_click", {"target": ref}))

    async def type_text(self, ref: str, text: str) -> str:
        return await self._text_entry_url(
            await self._call("browser_type", {"target": ref, "text": text})
        )

    async def fill_secret(self, ref: str, secret: str) -> str:
        return await self._text_entry_url(
            await self._call("browser_type", {"target": ref, "text": secret})
        )

    async def wait_for(self, text: str, state: str) -> str:
        if state == "present":
            arguments = {"text": text}
        elif state == "absent":
            arguments = {"textGone": text}
        else:
            raise PlaywrightMcpBackendError("Playwright MCP wait state unsupported")
        return _page_url(await self._call("browser_wait_for", arguments))

    async def observe(
        self,
        kind: OracleKind,
        subject: str,
    ) -> BackendObservation:
        if kind is OracleKind.URL:
            return BackendObservation(actual=(await self.snapshot()).current_url)
        if kind is OracleKind.ACCESSIBILITY_TEXT:
            return BackendObservation(actual=(await self.snapshot()).accessibility_tree)
        if kind is OracleKind.ELEMENT_COUNT:
            tree = (await self.snapshot()).accessibility_tree
            return BackendObservation(
                actual=sum(subject in line for line in tree.splitlines())
            )
        if kind is OracleKind.CONSOLE_ERRORS:
            result = await self._call(
                "browser_console_messages",
                {"level": "error", "all": False},
            )
            return BackendObservation(actual=_console_error_count(result))
        if kind is OracleKind.NETWORK_ERRORS:
            result = await self._call("browser_network_requests", {"static": False})
            return BackendObservation(actual=_network_error_count(result))
        raise PlaywrightMcpBackendError("Playwright MCP oracle kind unsupported")

    async def capture_evidence(self, reason: str) -> str:
        del reason
        result = await self._call("browser_take_screenshot", {"scale": "css"})
        lines = _result_section(result).splitlines()
        matches = [
            match for line in lines if (match := _SCREENSHOT_LINK.fullmatch(line))
        ]
        if len(matches) != 1:
            raise PlaywrightMcpBackendError(
                "Playwright MCP screenshot reference unavailable"
            )
        return f"playwright-mcp:///{matches[0].group('filename')}"

    async def _call(
        self,
        tool_name: str,
        arguments: dict[str, object],
    ) -> PlaywrightMcpToolResult:
        if self._tools is None:
            raise PlaywrightMcpBackendError("Playwright MCP backend is not active")
        return await self._tools.call(tool_name, arguments)

    async def _text_entry_url(self, result: PlaywrightMcpToolResult) -> str:
        if not any(result.text_blocks):
            return (await self.snapshot()).current_url
        return _page_url(result)


def _response_sections(result: PlaywrightMcpToolResult) -> dict[str, str]:
    text = "\n".join(result.text_blocks)
    sections: dict[str, str] = {}
    raw_sections = ("\n" + text).split("\n### ")[1:] if text.startswith("### ") else ()
    for raw_section in raw_sections:
        title, separator, content = raw_section.partition("\n")
        if not separator or title in sections:
            raise PlaywrightMcpBackendError("Playwright MCP response sections invalid")
        sections[title] = content.strip()
    if not sections:
        raise PlaywrightMcpBackendError("Playwright MCP response sections invalid")
    return sections


def _page_url(
    result: PlaywrightMcpToolResult,
    *,
    sections: dict[str, str] | None = None,
) -> str:
    page = (sections or _response_sections(result)).get("Page")
    if page is None:
        raise PlaywrightMcpBackendError("Playwright MCP page URL unavailable")
    urls = [
        line.removeprefix("- Page URL: ")
        for line in page.splitlines()
        if line.startswith("- Page URL: ")
    ]
    if len(urls) != 1:
        raise PlaywrightMcpBackendError("Playwright MCP page URL unavailable")
    return urls[0]


def _inline_snapshot(section: str) -> str:
    if not section.startswith("```yaml\n") or not section.endswith("\n```"):
        raise PlaywrightMcpBackendError("Playwright MCP snapshot unavailable")
    return section.removeprefix("```yaml\n").removesuffix("\n```")


def _result_section(result: PlaywrightMcpToolResult) -> str:
    section = _response_sections(result).get("Result")
    if section is None:
        raise PlaywrightMcpBackendError("Playwright MCP observation unavailable")
    return section


def _console_error_count(result: PlaywrightMcpToolResult) -> int:
    summary = _result_section(result).splitlines()[0]
    match = _CONSOLE_SUMMARY.fullmatch(summary)
    if match is None:
        raise PlaywrightMcpBackendError("Playwright MCP console summary invalid")
    return int(match.group("errors"))


def _network_error_count(result: PlaywrightMcpToolResult) -> int:
    errors = 0
    for line in _result_section(result).splitlines():
        if not line or line.startswith("Note: "):
            continue
        match = _NETWORK_LINE.fullmatch(line)
        if match is None:
            raise PlaywrightMcpBackendError("Playwright MCP network summary invalid")
        status = match.group("status")
        if status == "FAILED" or int(status) >= 400:
            errors += 1
    return errors


__all__ = [
    "PlaywrightMcpBackendError",
    "PlaywrightMcpBackendFactory",
    "PlaywrightMcpBrowserBackend",
]
