from __future__ import annotations

import asyncio

import pytest

from app.playwright_mcp_client import MCP_STDIO_LIMIT_BYTES
from app.playwright_mcp_lifecycle import (
    AsyncioMcpProcessSpawner,
    PlaywrightMcpLifecycle,
    PlaywrightMcpUnavailable,
)
from app.playwright_mcp_process import PlaywrightMcpProcessSpec


class _ChildDouble:
    def __init__(self) -> None:
        self.stdin = object()
        self.stdout = object()
        self.returncode = None
        self.terminated = 0
        self.killed = 0
        self.waits = 0

    def terminate(self) -> None:
        self.terminated += 1
        self.returncode = 0

    def kill(self) -> None:
        self.killed += 1
        self.returncode = -9

    async def wait(self) -> int:
        self.waits += 1
        assert self.returncode is not None
        return self.returncode


class _SpawnerDouble:
    def __init__(self, child: _ChildDouble) -> None:
        self.child = child
        self.specs = []

    async def spawn(self, spec):
        self.specs.append(spec)
        return self.child


class _UnavailableSpawner:
    async def spawn(self, spec):
        del spec
        raise OSError("executable not found")


class _HungChild(_ChildDouble):
    def __init__(self) -> None:
        super().__init__()
        self._killed = asyncio.Event()

    def terminate(self) -> None:
        self.terminated += 1

    def kill(self) -> None:
        super().kill()
        self._killed.set()

    async def wait(self) -> int:
        self.waits += 1
        await self._killed.wait()
        assert self.returncode is not None
        return self.returncode


@pytest.mark.asyncio
async def test_started_stdio_process_is_always_terminated_and_reaped() -> None:
    spec = PlaywrightMcpProcessSpec(
        executable="npx",
        arguments=("--offline", "@playwright/mcp@0.0.80"),
    )
    child = _ChildDouble()
    spawner = _SpawnerDouble(child)
    lifecycle = PlaywrightMcpLifecycle(
        spawner=spawner,
        shutdown_timeout_seconds=1,
    )

    process = await lifecycle.start(spec)

    assert spawner.specs == [spec]
    assert process.stdin is child.stdin
    assert process.stdout is child.stdout

    await process.close()

    assert child.terminated == 1
    assert child.killed == 0
    assert child.waits == 1


@pytest.mark.asyncio
async def test_start_fails_closed_and_reaps_a_child_without_stdio() -> None:
    spec = PlaywrightMcpProcessSpec(
        executable="npx",
        arguments=("--offline", "@playwright/mcp@0.0.80"),
    )
    child = _ChildDouble()
    child.stdout = None
    lifecycle = PlaywrightMcpLifecycle(
        spawner=_SpawnerDouble(child),
        shutdown_timeout_seconds=1,
    )

    with pytest.raises(PlaywrightMcpUnavailable, match="stdio unavailable"):
        await lifecycle.start(spec)

    assert child.terminated == 1
    assert child.waits == 1


@pytest.mark.asyncio
async def test_spawn_failure_is_reported_without_exposing_os_details() -> None:
    lifecycle = PlaywrightMcpLifecycle(spawner=_UnavailableSpawner())

    with pytest.raises(PlaywrightMcpUnavailable, match="process unavailable"):
        await lifecycle.start(
            PlaywrightMcpProcessSpec(
                executable="npx",
                arguments=("--offline", "@playwright/mcp@0.0.80"),
            )
        )


@pytest.mark.asyncio
async def test_shutdown_timeout_escalates_to_kill_and_reaps_the_child() -> None:
    child = _HungChild()
    lifecycle = PlaywrightMcpLifecycle(
        spawner=_SpawnerDouble(child),
        shutdown_timeout_seconds=0.001,
    )
    process = await lifecycle.start(
        PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        )
    )

    await process.close()

    assert child.terminated == 1
    assert child.killed == 1
    assert child.waits == 2


@pytest.mark.asyncio
async def test_cancelled_shutdown_kills_and_reaps_before_propagating() -> None:
    child = _HungChild()
    lifecycle = PlaywrightMcpLifecycle(
        spawner=_SpawnerDouble(child),
        shutdown_timeout_seconds=10,
    )
    process = await lifecycle.start(
        PlaywrightMcpProcessSpec(
            executable="npx",
            arguments=("--offline", "@playwright/mcp@0.0.80"),
        )
    )

    close_task = asyncio.create_task(process.close())
    await asyncio.sleep(0)
    close_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await close_task

    assert child.terminated == 1
    assert child.killed == 1
    assert child.waits == 2


@pytest.mark.asyncio
async def test_concrete_spawner_bounds_the_stdio_reader_buffer(monkeypatch) -> None:
    calls = []

    async def spawn(*arguments, **options):
        calls.append((arguments, options))
        return _ChildDouble()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    spec = PlaywrightMcpProcessSpec(
        executable="npx",
        arguments=("--offline", "@playwright/mcp@0.0.80"),
    )

    await AsyncioMcpProcessSpawner().spawn(spec)

    assert calls[0][1]["limit"] == MCP_STDIO_LIMIT_BYTES
