from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

import pytest

from app.playwright_mcp_backend import (
    PlaywrightMcpBackendError,
    PlaywrightMcpBackendFactory,
    PlaywrightMcpBrowserBackend,
)
from app.playwright_mcp_client import PlaywrightMcpProtocolError
from app.playwright_mcp_lifecycle import PlaywrightMcpLifecycle
from app.playwright_mcp_process import (
    PlaywrightMcpProcessSpec,
    PlaywrightMcpSettings,
    build_playwright_mcp_process,
)
from app.playwright_mcp_tools import PLAYWRIGHT_MCP_ALLOWED_TOOLS
from app.test_design import OracleKind
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_failure_investigation_workflow import _result


class _WriterDouble:
    def __init__(self) -> None:
        self.messages: list[bytes] = []

    def write(self, data: bytes) -> None:
        self.messages.append(data)

    async def drain(self) -> None:
        pass


class _ReaderDouble:
    def __init__(self, *responses: dict[str, object]) -> None:
        self._responses = [
            json.dumps(response, separators=(",", ":")).encode() + b"\n"
            for response in responses
        ]

    async def readline(self) -> bytes:
        return self._responses.pop(0) if self._responses else b""


class _ChildDouble:
    def __init__(self, *responses: dict[str, object]) -> None:
        self.stdin = _WriterDouble()
        self.stdout = _ReaderDouble(*responses)
        self.returncode: int | None = None
        self.terminated = 0

    def terminate(self) -> None:
        self.terminated += 1
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        assert self.returncode is not None
        return self.returncode


class _SpawnerDouble:
    def __init__(self, child: _ChildDouble) -> None:
        self.child = child
        self.specs: list[PlaywrightMcpProcessSpec] = []

    async def spawn(self, spec: PlaywrightMcpProcessSpec) -> _ChildDouble:
        self.specs.append(spec)
        return self.child


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
    }[name]
    return {
        "name": name,
        "inputSchema": {"type": "object", "properties": properties},
    }


def _initialize_response() -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "protocolVersion": "2025-11-25",
            "capabilities": {"tools": {}},
            "serverInfo": {
                "name": "Playwright",
                "version": "1.63.0-alpha-2026-08-31",
            },
        },
    }


def _tool_response(request_id: int, text: str) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {"content": [{"type": "text", "text": text}]},
    }


@pytest.mark.asyncio
async def test_backend_starts_pinned_runtime_and_maps_snapshot_first_actions() -> None:
    url = "https://app.example.test/profile"
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(
            3,
            f"### Page\n- Page URL: {url}\n- Page Title: Profile\n"
            '### Snapshot\n```yaml\n- heading "Profile" [ref=e1]\n```',
        ),
        _tool_response(
            4,
            f"### Page\n- Page URL: {url}\n- Page Title: Profile\n"
            '### Snapshot\n```yaml\n- heading "Profile" [ref=e1]\n'
            '- textbox "Display name" [ref=e2]\n```',
        ),
    )
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    await backend.start()
    assert await backend.navigate(url) == url
    snapshot = await backend.snapshot()
    await backend.close()

    assert snapshot.current_url == url
    assert snapshot.accessibility_tree == (
        '- heading "Profile" [ref=e1]\n- textbox "Display name" [ref=e2]'
    )
    messages = [json.loads(message) for message in child.stdin.messages]
    assert [message["method"] for message in messages] == [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call",
        "tools/call",
    ]
    assert child.terminated == 1


@pytest.mark.asyncio
async def test_backend_maps_typed_interactions_without_returning_secret_text() -> None:
    url = "https://app.example.test/profile"
    response = f"### Page\n- Page URL: {url}\n"
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        *(_tool_response(request_id, response) for request_id in range(3, 8)),
    )
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    await backend.start()
    results = (
        await backend.click("e1"),
        await backend.type_text("e2", "Public Name"),
        await backend.fill_secret("e3", "private-password"),
        await backend.wait_for("Saved", "present"),
        await backend.wait_for("Saving", "absent"),
    )
    await backend.close()

    assert results == (url, url, url, url, url)
    calls = [
        json.loads(message)["params"]
        for message in child.stdin.messages
        if json.loads(message).get("method") == "tools/call"
    ]
    assert calls == [
        {"name": "browser_click", "arguments": {"target": "e1"}},
        {
            "name": "browser_type",
            "arguments": {"target": "e2", "text": "Public Name"},
        },
        {
            "name": "browser_type",
            "arguments": {"target": "e3", "text": "private-password"},
        },
        {"name": "browser_wait_for", "arguments": {"text": "Saved"}},
        {"name": "browser_wait_for", "arguments": {"textGone": "Saving"}},
    ]
    assert "private-password" not in "".join(results)


@pytest.mark.asyncio
async def test_text_entry_refreshes_snapshot_when_action_omits_page_metadata() -> None:
    url = "https://app.example.test/profile"
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(3, ""),
        _tool_response(
            4,
            f"### Page\n- Page URL: {url}\n"
            '### Snapshot\n```yaml\n- textbox "Display name" [ref=e2]\n```',
        ),
    )
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    await backend.start()
    current_url = await backend.type_text("e2", "Public Name")
    await backend.close()

    assert current_url == url
    calls = [
        json.loads(message)["params"]["name"]
        for message in child.stdin.messages
        if json.loads(message).get("method") == "tools/call"
    ]
    assert calls == ["browser_type", "browser_snapshot"]


@pytest.mark.asyncio
async def test_backend_collects_deterministic_harness_oracle_values() -> None:
    url = "https://app.example.test/cart"
    snapshot = (
        f"### Page\n- Page URL: {url}\n"
        "### Snapshot\n```yaml\n"
        '- button "Add to cart" [ref=e1]\n'
        '- button "Add to cart" [ref=e2]\n'
        '- status "Cart updated" [ref=e3]\n```'
    )
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(3, snapshot),
        _tool_response(4, snapshot),
        _tool_response(5, snapshot),
        _tool_response(
            6,
            "### Result\nTotal messages: 2 (Errors: 2, Warnings: 0)\n\n"
            "[ERROR] first failure\n[ERROR] second failure",
        ),
        _tool_response(
            7,
            "### Result\n"
            "1. [GET] https://app.example.test/api/cart => [200] OK\n"
            "2. [POST] https://app.example.test/api/cart => [500] Error\n"
            "3. [GET] https://app.example.test/api/user => [FAILED] reset",
        ),
    )
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    await backend.start()
    url_actual = await backend.observe(OracleKind.URL, "current page")
    text_actual = await backend.observe(
        OracleKind.ACCESSIBILITY_TEXT,
        "cart status",
    )
    count_actual = await backend.observe(
        OracleKind.ELEMENT_COUNT,
        'button "Add to cart"',
    )
    console_actual = await backend.observe(OracleKind.CONSOLE_ERRORS, "page")
    network_actual = await backend.observe(OracleKind.NETWORK_ERRORS, "page")
    await backend.close()

    assert url_actual.actual == url
    assert text_actual.actual == (
        '- button "Add to cart" [ref=e1]\n'
        '- button "Add to cart" [ref=e2]\n'
        '- status "Cart updated" [ref=e3]'
    )
    assert count_actual.actual == 2
    assert console_actual.actual == 2
    assert network_actual.actual == 2
    assert all(
        observation.evidence_ref is None
        for observation in (
            url_actual,
            text_actual,
            count_actual,
            console_actual,
            network_actual,
        )
    )


@pytest.mark.asyncio
async def test_backend_returns_only_an_isolated_screenshot_evidence_reference() -> None:
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(
            3,
            "### Result\n"
            "- [Screenshot of viewport](./page-2026-09-08T20-00-00-000Z.png)\n"
            "### Page\n- Page URL: https://app.example.test/cart",
        ),
    )
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    await backend.start()
    evidence_ref = await backend.capture_evidence("cart assertion failed")
    await backend.close()

    assert evidence_ref == "playwright-mcp:///page-2026-09-08T20-00-00-000Z.png"
    call = json.loads(child.stdin.messages[-1])
    assert call["params"] == {
        "name": "browser_take_screenshot",
        "arguments": {"scale": "css"},
    }


@pytest.mark.asyncio
async def test_backend_factory_binds_runtime_to_the_approved_attempt_scope() -> None:
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
    )
    spawner = _SpawnerDouble(child)
    lifecycle = PlaywrightMcpLifecycle(spawner=spawner)
    settings = PlaywrightMcpSettings(output_root=PurePosixPath("/tmp/qali-mcp"))
    task = _execution_task()
    factory = PlaywrightMcpBackendFactory(
        settings=settings,
        lifecycle=lifecycle,
    )

    backend = await factory.create(context_id="context-attempt-001", task=task)
    await backend.start()
    await backend.close()

    assert spawner.specs == [
        build_playwright_mcp_process(
            task=task,
            context_id="context-attempt-001",
            settings=settings,
        )
    ]


@pytest.mark.asyncio
async def test_backend_factory_captures_bounded_failure_evidence_before_close(
    tmp_path: Path,
) -> None:
    context_id = "context-failure-001"
    output_root = tmp_path / "qali-mcp"
    output_dir = output_root / context_id
    traces_dir = output_dir / "traces"
    resources_dir = traces_dir / "resources"
    resources_dir.mkdir(parents=True)
    (traces_dir / "trace-123.trace").write_bytes(
        b'{"type":"fill","text":"private-password"}\n'
    )
    (traces_dir / "trace-123.network").write_bytes(b"network trace")
    (resources_dir / "resource-1").write_bytes(b"resource body")
    (output_dir / "page-failure.png").write_bytes(b"png image")
    url = "https://app.example.test/cart"
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(
            3,
            "### Result\nTrace recording started\n"
            "- [Action log](traces/trace-123.trace)\n"
            "- [Network log](traces/trace-123.network)\n"
            "- [Resources](traces/resources)",
        ),
        _tool_response(
            4,
            f"### Page\n- Page URL: {url}\n- Page Title: Cart",
        ),
        _tool_response(
            5,
            f"### Page\n- Page URL: {url}\n- Page Title: Cart",
        ),
        _tool_response(
            6,
            f"### Page\n- Page URL: {url}\n"
            '### Snapshot\n```yaml\n- alert "Checkout failed" [ref=e1]\n```',
        ),
        _tool_response(
            7,
            "### Result\nTotal messages: 3 (Errors: 1, Warnings: 0)\n\n"
            "[ERROR] checkout failed\n[INFO] retry offered\n"
            "[INFO] submitted private-password",
        ),
        _tool_response(
            8,
            "### Result\n"
            "1. [POST] https://app.example.test/api/checkout => "
            "[500] private-password\n"
            "2. [GET] https://app.example.test/api/cart => [200] OK",
        ),
        _tool_response(
            9,
            "### Result\n- [Screenshot of viewport](./page-failure.png)\n"
            f"### Page\n- Page URL: {url}",
        ),
        _tool_response(
            10,
            "### Result\nTrace recording stopped.\n"
            "- [Trace](traces/trace-123.trace)\n"
            "- [Network log](traces/trace-123.network)\n"
            "- [Resources](traces/resources)",
        ),
    )
    factory = PlaywrightMcpBackendFactory(
        settings=PlaywrightMcpSettings(output_root=PurePosixPath(output_root)),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )
    task = _execution_task()

    backend = await factory.create(context_id=context_id, task=task)
    with pytest.raises(PlaywrightMcpBackendError, match="already used"):
        await factory.create(context_id=context_id, task=task)
    await backend.start()
    assert await backend.navigate(url) == url
    assert await backend.fill_secret("e2", "private-password") == url
    with pytest.raises(PlaywrightMcpBackendError, match="evidence is unavailable"):
        await factory.capture_failure(
            context_id=context_id,
            task=task,
            result=_result(passed=False),
        )
    await backend.close()
    with pytest.raises(PlaywrightMcpBackendError, match="failed scenario result"):
        await factory.capture_failure(
            context_id=context_id,
            task=task,
            result=_result(passed=True),
        )
    with pytest.raises(PlaywrightMcpBackendError, match="scope does not match"):
        await factory.capture_failure(
            context_id=context_id,
            task=task.model_copy(update={"run_id": "run-substituted-001"}),
            result=_result(passed=False),
        )
    capture = await factory.capture_failure(
        context_id=context_id,
        task=task,
        result=_result(passed=False),
    )

    assert capture.accessibility_snapshot == '- alert "Checkout failed" [ref=e1]'
    assert capture.console_events == (
        {"level": "error", "text": "checkout failed"},
        {"level": "info", "text": "retry offered"},
        {"level": "info", "text": "submitted <redacted>"},
    )
    assert capture.network_events == (
        {
            "method": "POST",
            "url": "https://app.example.test/api/checkout",
            "status": 500,
            "detail": "<redacted>",
        },
        {
            "method": "GET",
            "url": "https://app.example.test/api/cart",
            "status": 200,
            "detail": "OK",
        },
    )
    assert capture.screenshot == b"png image"
    archive = tmp_path / "trace.zip"
    archive.write_bytes(capture.trace)
    with ZipFile(archive) as trace_zip:
        assert trace_zip.namelist() == [
            "trace.trace",
            "trace.network",
            "resources/resource-1",
        ]
        assert trace_zip.read("trace.trace") == (
            b'{"type":"fill","text":"<redacted>"}\n'
        )
    assert b"private-password" not in capture.trace
    calls = [
        json.loads(message)["params"]
        for message in child.stdin.messages
        if json.loads(message).get("method") == "tools/call"
    ]
    assert calls == [
        {"name": "browser_start_tracing", "arguments": {}},
        {"name": "browser_navigate", "arguments": {"url": url}},
        {
            "name": "browser_type",
            "arguments": {"target": "e2", "text": "private-password"},
        },
        {"name": "browser_snapshot", "arguments": {}},
        {
            "name": "browser_console_messages",
            "arguments": {"level": "info", "all": True},
        },
        {"name": "browser_network_requests", "arguments": {"static": False}},
        {"name": "browser_take_screenshot", "arguments": {"scale": "css"}},
        {"name": "browser_stop_tracing", "arguments": {}},
    ]
    assert child.terminated == 1


@pytest.mark.asyncio
async def test_failure_capture_rejects_symlinked_trace_and_reaps_runtime(
    tmp_path: Path,
) -> None:
    context_id = "context-symlink-001"
    output_root = tmp_path / "qali-mcp"
    output_dir = output_root / context_id
    traces_dir = output_dir / "traces"
    (traces_dir / "resources").mkdir(parents=True)
    (traces_dir / "actual.trace").write_bytes(b"trace events")
    (traces_dir / "trace-123.trace").symlink_to(traces_dir / "actual.trace")
    (traces_dir / "trace-123.network").write_bytes(b"network trace")
    (output_dir / "page-failure.png").write_bytes(b"png image")
    url = "https://app.example.test/cart"
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(3, "### Result\nTrace recording started"),
        _tool_response(4, f"### Page\n- Page URL: {url}"),
        _tool_response(
            5,
            f"### Page\n- Page URL: {url}\n"
            '### Snapshot\n```yaml\n- alert "Failure" [ref=e1]\n```',
        ),
        _tool_response(
            6,
            "### Result\nTotal messages: 0 (Errors: 0, Warnings: 0)",
        ),
        _tool_response(7, "### Result\n"),
        _tool_response(
            8,
            "### Result\n- [Screenshot of viewport](./page-failure.png)\n"
            f"### Page\n- Page URL: {url}",
        ),
        _tool_response(
            9,
            "### Result\nTrace recording stopped.\n"
            "- [Trace](traces/trace-123.trace)\n"
            "- [Network log](traces/trace-123.network)\n"
            "- [Resources](traces/resources)",
        ),
    )
    factory = PlaywrightMcpBackendFactory(
        settings=PlaywrightMcpSettings(output_root=PurePosixPath(output_root)),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )
    backend = await factory.create(context_id=context_id, task=_execution_task())

    await backend.start()
    await backend.navigate(url)
    with pytest.raises(PlaywrightMcpBackendError, match="path is unsafe"):
        await backend.close()

    assert child.terminated == 1


@pytest.mark.asyncio
async def test_backend_rejects_unrecognized_network_output_instead_of_false_pass() -> (
    None
):
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(3, "### Result\nserver says all requests passed"),
    )
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    await backend.start()
    with pytest.raises(PlaywrightMcpBackendError, match="network summary invalid"):
        await backend.observe(OracleKind.NETWORK_ERRORS, "page")
    await backend.close()


@pytest.mark.asyncio
async def test_backend_reaps_runtime_when_pinned_initialization_fails() -> None:
    child = _ChildDouble(
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
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    with pytest.raises(PlaywrightMcpProtocolError, match="version mismatch"):
        await backend.start()

    assert child.terminated == 1


@pytest.mark.asyncio
async def test_backend_rejects_screenshot_reference_outside_isolated_output() -> None:
    child = _ChildDouble(
        _initialize_response(),
        {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"tools": [_tool(name) for name in PLAYWRIGHT_MCP_ALLOWED_TOOLS]},
        },
        _tool_response(
            3,
            "### Result\n- [Screenshot of viewport](../../private.png)\n"
            "### Page\n- Page URL: https://app.example.test/cart",
        ),
    )
    backend = PlaywrightMcpBrowserBackend(
        process_spec=PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        ),
        lifecycle=PlaywrightMcpLifecycle(spawner=_SpawnerDouble(child)),
    )

    await backend.start()
    with pytest.raises(PlaywrightMcpBackendError, match="reference unavailable"):
        await backend.capture_evidence("failure")
    await backend.close()
