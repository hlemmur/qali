from __future__ import annotations

import pytest

from app.browser_context_factory import (
    BrowserContextFactoryError,
    RestrictedBrowserContextFactory,
)
from app.browser_policy import NavigateAction, SnapshotAction
from tests.integration.test_browser_executor_agent import _execution_task
from tests.integration.test_browser_facade import (
    _BackendDouble,
    _CredentialResolverDouble,
)


class _BackendFactoryDouble:
    def __init__(self) -> None:
        self.calls = []
        self.backends = []

    async def create(self, *, context_id, task):
        self.calls.append((context_id, task))
        backend = _BackendDouble()
        self.backends.append(backend)
        return backend


@pytest.mark.asyncio
async def test_factory_binds_a_fresh_backend_to_only_the_approved_task_scope() -> None:
    task = _execution_task()
    backends = _BackendFactoryDouble()
    credentials = _CredentialResolverDouble()
    context_ids = iter(("context-run-001", "context-run-002"))
    factory = RestrictedBrowserContextFactory(
        backends=backends,
        credentials=credentials,
        context_id_factory=lambda: next(context_ids),
    )

    first = await factory.create(task)
    second = await factory.create(task)

    assert first.context_id == "context-run-001"
    assert second.context_id == "context-run-002"
    assert first.session is not second.session
    assert backends.calls == [
        ("context-run-001", task),
        ("context-run-002", task),
    ]

    async with first.session:
        await first.session.execute(NavigateAction(url=task.target_policy.start_url))
        snapshot = await first.session.execute(SnapshotAction())

    assert snapshot.snapshot is not None
    assert snapshot.snapshot.current_url == task.target_policy.start_url


@pytest.mark.asyncio
async def test_unsafe_context_id_is_rejected_before_backend_creation() -> None:
    backends = _BackendFactoryDouble()
    factory = RestrictedBrowserContextFactory(
        backends=backends,
        credentials=_CredentialResolverDouble(),
        context_id_factory=lambda: "../shared-context",
    )

    with pytest.raises(BrowserContextFactoryError, match="safe isolated context"):
        await factory.create(_execution_task())

    assert backends.calls == []
