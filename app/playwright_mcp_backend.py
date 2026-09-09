from __future__ import annotations

import json
import re
from collections.abc import Callable
from io import BytesIO
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from app.browser_evidence_export import BrowserFailureEvidenceCapture
from app.browser_executor_agent import BrowserExecutionTask, BrowserScenarioResult
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
    r"^(?P<index>\d+)\. \[(?P<method>[A-Z]+)\] (?P<url>\S+) => "
    r"\[(?P<status>FAILED|\d{3})\](?: (?P<detail>.*))?$"
)
_CONSOLE_LINE = re.compile(r"^\[(?P<level>[A-Z]+)\] (?P<text>.*)$")
_SCREENSHOT_LINK = re.compile(
    r"^- \[Screenshot of (?:viewport|full page|element)\]"
    r"\(\./(?P<filename>[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.png)\)$"
)
_TRACE_LINK = re.compile(
    r"^- \[(?P<title>Trace|Network log|Resources)\]"
    r"\((?P<path>[A-Za-z0-9][A-Za-z0-9._/-]{0,499})\)$"
)
_MAX_TRACE_BYTES = 50_000_000
_MAX_SCREENSHOT_BYTES = 10_000_000
_MAX_EVENT_COUNT = 10_000
_MAX_TRACE_FILES = 10_000


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
        self._tasks: dict[str, BrowserExecutionTask] = {}
        self._captures: dict[str, BrowserFailureEvidenceCapture] = {}

    async def create(
        self,
        *,
        context_id: str,
        task: BrowserExecutionTask,
    ) -> PlaywrightMcpBrowserBackend:
        if context_id in self._tasks:
            raise PlaywrightMcpBackendError(
                "Playwright MCP context identifier was already used"
            )
        process_spec = build_playwright_mcp_process(
            task=task,
            context_id=context_id,
            settings=self._settings,
        )
        self._tasks[context_id] = task
        output_dir = Path(self._settings.output_root / context_id)
        return PlaywrightMcpBrowserBackend(
            process_spec=process_spec,
            lifecycle=self._lifecycle,
            initializer=self._initializer,
            output_dir=output_dir,
            evidence_sink=lambda capture: self._store_capture(context_id, capture),
        )

    async def capture_failure(
        self,
        *,
        context_id: str,
        task: BrowserExecutionTask,
        result: BrowserScenarioResult,
    ) -> BrowserFailureEvidenceCapture:
        expected_task = self._tasks.get(context_id)
        if expected_task is None or expected_task != task:
            raise PlaywrightMcpBackendError(
                "Playwright MCP evidence scope does not match its browser attempt"
            )
        if result.scenario_id != task.scenario.scenario_id or result.evaluation.passed:
            raise PlaywrightMcpBackendError(
                "Playwright MCP evidence requires its failed scenario result"
            )
        capture = self._captures.get(context_id)
        if capture is None:
            raise PlaywrightMcpBackendError(
                "Playwright MCP failure evidence is unavailable"
            )
        return capture

    def _store_capture(
        self,
        context_id: str,
        capture: BrowserFailureEvidenceCapture,
    ) -> None:
        if context_id in self._captures:
            raise PlaywrightMcpBackendError(
                "Playwright MCP failure evidence was already captured"
            )
        self._captures[context_id] = capture


class PlaywrightMcpBrowserBackend:
    def __init__(
        self,
        *,
        process_spec: PlaywrightMcpProcessSpec,
        lifecycle: PlaywrightMcpLifecycle | None = None,
        initializer: PlaywrightMcpInitializer | None = None,
        output_dir: Path | None = None,
        evidence_sink: Callable[[BrowserFailureEvidenceCapture], None] | None = None,
    ) -> None:
        self._process_spec = process_spec
        self._lifecycle = lifecycle or PlaywrightMcpLifecycle()
        self._initializer = initializer or PlaywrightMcpInitializer()
        self._process: ManagedMcpProcess | None = None
        self._tools: PlaywrightMcpToolClient | None = None
        self._output_dir = output_dir
        self._evidence_sink = evidence_sink
        self._tracing = False
        self._secret_values: list[str] = []

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
        try:
            if self._tracing and self._evidence_sink is not None:
                self._evidence_sink(await self._capture_failure_evidence())
        finally:
            self._tools = None
            self._tracing = False
            if process is not None:
                await process.close()

    async def navigate(self, url: str) -> str:
        await self._ensure_tracing()
        result = await self._call("browser_navigate", {"url": url})
        return _page_url(result)

    async def snapshot(self) -> AccessibilitySnapshot:
        await self._ensure_tracing()
        return await self._snapshot()

    async def _snapshot(self) -> AccessibilitySnapshot:
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
        await self._ensure_tracing()
        return _page_url(await self._call("browser_click", {"target": ref}))

    async def type_text(self, ref: str, text: str) -> str:
        await self._ensure_tracing()
        return await self._text_entry_url(
            await self._call("browser_type", {"target": ref, "text": text})
        )

    async def fill_secret(self, ref: str, secret: str) -> str:
        await self._ensure_tracing()
        if secret and secret not in self._secret_values:
            self._secret_values.append(secret)
        return await self._text_entry_url(
            await self._call("browser_type", {"target": ref, "text": secret})
        )

    async def wait_for(self, text: str, state: str) -> str:
        await self._ensure_tracing()
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
        await self._ensure_tracing()
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
        await self._ensure_tracing()
        del reason
        result = await self._call("browser_take_screenshot", {"scale": "css"})
        return f"playwright-mcp:///{_screenshot_filename(result)}"

    async def _ensure_tracing(self) -> None:
        if self._evidence_sink is None or self._tracing:
            return
        await self._call("browser_start_tracing", {})
        self._tracing = True

    async def _capture_failure_evidence(self) -> BrowserFailureEvidenceCapture:
        if self._output_dir is None:
            raise PlaywrightMcpBackendError(
                "Playwright MCP evidence output directory unavailable"
            )
        try:
            snapshot = await self._snapshot()
            console = await self._call(
                "browser_console_messages", {"level": "info", "all": True}
            )
            network = await self._call("browser_network_requests", {"static": False})
            screenshot = await self._call("browser_take_screenshot", {"scale": "css"})
        finally:
            trace = await self._call("browser_stop_tracing", {})
        secret_values = tuple(self._secret_values)
        screenshot_content = _read_output_file(
            self._output_dir,
            PurePosixPath(_screenshot_filename(screenshot)),
            maximum=_MAX_SCREENSHOT_BYTES,
        )
        if _contains_secret(screenshot_content, secret_values):
            raise PlaywrightMcpBackendError(
                "Playwright MCP screenshot contains credential material"
            )
        return BrowserFailureEvidenceCapture(
            trace=_trace_archive(
                self._output_dir,
                trace,
                secret_values=secret_values,
            ),
            accessibility_snapshot=_redact_text(
                snapshot.accessibility_tree,
                secret_values,
            ),
            console_events=_redact_events(_console_events(console), secret_values),
            network_events=_redact_events(_network_events(network), secret_values),
            screenshot=screenshot_content,
        )

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
    lines = _result_section(result).splitlines()
    if not lines:
        raise PlaywrightMcpBackendError("Playwright MCP console summary invalid")
    summary = lines[0]
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


def _screenshot_filename(result: PlaywrightMcpToolResult) -> str:
    matches = [
        match
        for line in _result_section(result).splitlines()
        if (match := _SCREENSHOT_LINK.fullmatch(line))
    ]
    if len(matches) != 1:
        raise PlaywrightMcpBackendError(
            "Playwright MCP screenshot reference unavailable"
        )
    return matches[0].group("filename")


def _console_events(
    result: PlaywrightMcpToolResult,
) -> tuple[dict[str, str], ...]:
    lines = _result_section(result).splitlines()
    if not lines or _CONSOLE_SUMMARY.fullmatch(lines[0]) is None:
        raise PlaywrightMcpBackendError("Playwright MCP console summary invalid")
    events: list[dict[str, str]] = []
    for line in lines[1:]:
        if not line:
            continue
        match = _CONSOLE_LINE.fullmatch(line)
        if match is None:
            events.append({"level": "error", "text": line})
        else:
            events.append(
                {
                    "level": match.group("level").lower(),
                    "text": match.group("text"),
                }
            )
        if len(events) > _MAX_EVENT_COUNT:
            raise PlaywrightMcpBackendError(
                "Playwright MCP console evidence exceeds its event limit"
            )
    return tuple(events)


def _network_events(
    result: PlaywrightMcpToolResult,
) -> tuple[dict[str, str | int], ...]:
    events: list[dict[str, str | int]] = []
    for line in _result_section(result).splitlines():
        if not line or line.startswith("Note: "):
            continue
        match = _NETWORK_LINE.fullmatch(line)
        if match is None:
            raise PlaywrightMcpBackendError("Playwright MCP network summary invalid")
        status = match.group("status")
        events.append(
            {
                "method": match.group("method"),
                "url": match.group("url"),
                "status": status if status == "FAILED" else int(status),
                "detail": match.group("detail") or "",
            }
        )
        if len(events) > _MAX_EVENT_COUNT:
            raise PlaywrightMcpBackendError(
                "Playwright MCP network evidence exceeds its event limit"
            )
    return tuple(events)


def _trace_archive(
    output_dir: Path,
    result: PlaywrightMcpToolResult,
    *,
    secret_values: tuple[str, ...] = (),
) -> bytes:
    lines = _result_section(result).splitlines()
    if not lines or lines[0] != "Trace recording stopped.":
        raise PlaywrightMcpBackendError("Playwright MCP trace references unavailable")
    links: dict[str, PurePosixPath] = {}
    for line in lines[1:]:
        match = _TRACE_LINK.fullmatch(line)
        if match is None or match.group("title") in links:
            raise PlaywrightMcpBackendError(
                "Playwright MCP trace references unavailable"
            )
        links[match.group("title")] = PurePosixPath(match.group("path"))
    if set(links) != {"Trace", "Network log", "Resources"}:
        raise PlaywrightMcpBackendError("Playwright MCP trace references unavailable")

    files = [
        (
            "trace.trace",
            _read_output_file(
                output_dir,
                links["Trace"],
                maximum=_MAX_TRACE_BYTES,
            ),
        ),
        (
            "trace.network",
            _read_output_file(
                output_dir,
                links["Network log"],
                maximum=_MAX_TRACE_BYTES,
            ),
        ),
    ]
    resources = _safe_output_path(output_dir, links["Resources"])
    if not resources.is_dir() or resources.is_symlink():
        raise PlaywrightMcpBackendError("Playwright MCP trace resources unavailable")
    for resource in sorted(resources.rglob("*")):
        if resource.is_symlink():
            raise PlaywrightMcpBackendError("Playwright MCP evidence path is unsafe")
        if not resource.is_file():
            continue
        relative = resource.relative_to(resources).as_posix()
        files.append(
            (
                f"resources/{relative}",
                _read_output_file(
                    resources,
                    PurePosixPath(relative),
                    maximum=_MAX_TRACE_BYTES,
                ),
            )
        )
        if len(files) > _MAX_TRACE_FILES:
            raise PlaywrightMcpBackendError(
                "Playwright MCP trace exceeds its file limit"
            )
    files = [(name, _redact_bytes(content, secret_values)) for name, content in files]
    if sum(len(content) for _, content in files) > _MAX_TRACE_BYTES:
        raise PlaywrightMcpBackendError("Playwright MCP trace exceeds its size limit")

    target = BytesIO()
    with ZipFile(target, mode="w", compression=ZIP_DEFLATED) as archive:
        for name, content in files:
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, content)
    value = target.getvalue()
    if len(value) > _MAX_TRACE_BYTES:
        raise PlaywrightMcpBackendError("Playwright MCP trace exceeds its size limit")
    return value


def _read_output_file(
    output_dir: Path,
    relative_path: PurePosixPath,
    *,
    maximum: int,
) -> bytes:
    path = _safe_output_path(output_dir, relative_path)
    if path.is_symlink() or not path.is_file():
        raise PlaywrightMcpBackendError("Playwright MCP evidence file unavailable")
    size = path.stat().st_size
    if not 0 < size <= maximum:
        raise PlaywrightMcpBackendError(
            "Playwright MCP evidence file exceeds its size limit"
        )
    content = path.read_bytes()
    if len(content) != size:
        raise PlaywrightMcpBackendError("Playwright MCP evidence file changed")
    return content


def _safe_output_path(output_dir: Path, relative_path: PurePosixPath) -> Path:
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise PlaywrightMcpBackendError("Playwright MCP evidence path is unsafe")
    if output_dir.is_symlink():
        raise PlaywrightMcpBackendError("Playwright MCP evidence path is unsafe")
    candidate = output_dir
    for part in relative_path.parts:
        candidate /= part
        if candidate.is_symlink():
            raise PlaywrightMcpBackendError("Playwright MCP evidence path is unsafe")
    root = output_dir.resolve()
    path = candidate.resolve()
    if not path.is_relative_to(root):
        raise PlaywrightMcpBackendError("Playwright MCP evidence path is unsafe")
    return path


def _redact_events(
    events: tuple[dict[str, str], ...] | tuple[dict[str, str | int], ...],
    secret_values: tuple[str, ...],
) -> tuple[dict[str, str | int], ...]:
    return tuple(
        {
            key: _redact_text(value, secret_values) if isinstance(value, str) else value
            for key, value in event.items()
        }
        for event in events
    )


def _redact_text(value: str, secret_values: tuple[str, ...]) -> str:
    for secret in secret_values:
        for representation in _secret_representations(secret):
            value = value.replace(representation, "<redacted>")
    return value


def _redact_bytes(value: bytes, secret_values: tuple[str, ...]) -> bytes:
    for secret in secret_values:
        for representation in _secret_representations(secret):
            value = value.replace(representation.encode(), b"<redacted>")
    return value


def _contains_secret(value: bytes, secret_values: tuple[str, ...]) -> bool:
    return any(
        representation.encode() in value
        for secret in secret_values
        for representation in _secret_representations(secret)
    )


def _secret_representations(secret: str) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            (
                secret,
                json.dumps(secret, ensure_ascii=True)[1:-1],
                quote(secret, safe=""),
            )
        )
    )


__all__ = [
    "PlaywrightMcpBackendError",
    "PlaywrightMcpBackendFactory",
    "PlaywrightMcpBrowserBackend",
]
