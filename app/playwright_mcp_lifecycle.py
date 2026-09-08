from __future__ import annotations

import asyncio
from typing import Protocol

from app.playwright_mcp_process import PlaywrightMcpProcessSpec


class McpChildProcess(Protocol):
    stdin: object | None
    stdout: object | None
    returncode: int | None

    def terminate(self) -> None: ...

    def kill(self) -> None: ...

    async def wait(self) -> int: ...


class McpProcessSpawner(Protocol):
    async def spawn(self, spec: PlaywrightMcpProcessSpec) -> McpChildProcess: ...


class PlaywrightMcpUnavailable(RuntimeError):
    pass


class AsyncioMcpProcessSpawner:
    async def spawn(self, spec: PlaywrightMcpProcessSpec) -> McpChildProcess:
        return await asyncio.create_subprocess_exec(
            spec.executable,
            *spec.arguments,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env=spec.environment,
            start_new_session=True,
        )


class ManagedMcpProcess:
    def __init__(
        self,
        *,
        child: McpChildProcess,
        shutdown_timeout_seconds: float,
    ) -> None:
        self._child = child
        self._shutdown_timeout_seconds = shutdown_timeout_seconds

    @property
    def stdin(self) -> object:
        assert self._child.stdin is not None
        return self._child.stdin

    @property
    def stdout(self) -> object:
        assert self._child.stdout is not None
        return self._child.stdout

    async def close(self) -> None:
        if self._child.returncode is not None:
            return
        self._child.terminate()
        try:
            await asyncio.wait_for(
                self._child.wait(), timeout=self._shutdown_timeout_seconds
            )
        except asyncio.CancelledError:
            if self._child.returncode is None:
                self._child.kill()
            await self._child.wait()
            raise
        except TimeoutError:
            if self._child.returncode is None:
                self._child.kill()
            await self._child.wait()


class PlaywrightMcpLifecycle:
    def __init__(
        self,
        *,
        spawner: McpProcessSpawner | None = None,
        shutdown_timeout_seconds: float = 5,
    ) -> None:
        if not 0 < shutdown_timeout_seconds <= 30:
            raise ValueError("MCP shutdown timeout must be between 0 and 30 seconds")
        self._spawner = spawner or AsyncioMcpProcessSpawner()
        self._shutdown_timeout_seconds = shutdown_timeout_seconds

    async def start(self, spec: PlaywrightMcpProcessSpec) -> ManagedMcpProcess:
        try:
            child = await self._spawner.spawn(spec)
        except OSError:
            raise PlaywrightMcpUnavailable(
                "Playwright MCP process unavailable"
            ) from None
        process = ManagedMcpProcess(
            child=child,
            shutdown_timeout_seconds=self._shutdown_timeout_seconds,
        )
        if child.stdin is None or child.stdout is None:
            await process.close()
            raise PlaywrightMcpUnavailable("Playwright MCP stdio unavailable")
        return process


__all__ = [
    "AsyncioMcpProcessSpawner",
    "ManagedMcpProcess",
    "PlaywrightMcpLifecycle",
    "PlaywrightMcpUnavailable",
]
