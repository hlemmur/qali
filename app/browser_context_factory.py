from __future__ import annotations

import re
from collections.abc import Callable
from typing import Protocol
from uuid import uuid4

from app.browser_attempt_runner import BrowserAttemptContext
from app.browser_executor_agent import BrowserExecutionTask
from app.browser_facade import (
    BrowserBackend,
    CredentialResolver,
    RestrictedBrowserSession,
)

_CONTEXT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,127}$")


class BrowserBackendFactory(Protocol):
    async def create(
        self,
        *,
        context_id: str,
        task: BrowserExecutionTask,
    ) -> BrowserBackend: ...


class BrowserContextFactoryError(RuntimeError):
    pass


class RestrictedBrowserContextFactory:
    def __init__(
        self,
        *,
        backends: BrowserBackendFactory,
        credentials: CredentialResolver,
        context_id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._backends = backends
        self._credentials = credentials
        self._context_id_factory = context_id_factory or _new_context_id

    async def create(self, task: BrowserExecutionTask) -> BrowserAttemptContext:
        context_id = self._context_id_factory()
        if _CONTEXT_ID.fullmatch(context_id) is None:
            raise BrowserContextFactoryError(
                "browser backend requires a safe isolated context ID"
            )
        backend = await self._backends.create(context_id=context_id, task=task)
        oracles = (
            *task.scenario.positive_oracles,
            *task.scenario.forbidden_state_oracles,
        )
        return BrowserAttemptContext(
            context_id=context_id,
            session=RestrictedBrowserSession(
                policy=task.target_policy,
                approved_oracles=oracles,
                backend=backend,
                credentials=self._credentials,
            ),
        )


def _new_context_id() -> str:
    return f"context-{uuid4().hex}"


__all__ = [
    "BrowserContextFactoryError",
    "RestrictedBrowserContextFactory",
]
