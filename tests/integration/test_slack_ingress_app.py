import httpx
import pytest
from fastapi import FastAPI

from app.slack_app import (
    create_slack_ingress_app,
    create_slack_ingress_app_from_env,
)
from app.slack_ingress import (
    InMemoryJobRepository,
    InMemoryTaskDispatcher,
    SlackIngressSettings,
)


@pytest.mark.asyncio
async def test_mock_ingress_app_exposes_visible_mode_badge_and_slack_route() -> None:
    app = create_slack_ingress_app(
        settings=SlackIngressSettings(
            signing_secret="test-signing-secret",
            workspace_id="T-QALI",
            channel_id="C-QALI",
            owner_user_id="U-OWNER",
        ),
        jobs=InMemoryJobRepository(),
        tasks=InMemoryTaskDispatcher(),
        mode="mock",
        clock=lambda: 1_788_220_800,
    )

    assert isinstance(app, FastAPI)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://qali.test",
    ) as client:
        response = await client.get("/healthz")
        slack_response = await client.post("/slack/events", content=b"{}")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "mode": "mock",
        "badge": "MOCK MODE",
    }
    assert slack_response.status_code == 401


def test_runtime_factory_requires_explicit_mock_mode() -> None:
    with pytest.raises(RuntimeError, match="QALI_MODE must be set explicitly"):
        create_slack_ingress_app_from_env({})

    app = create_slack_ingress_app_from_env({"QALI_MODE": "mock"})

    assert isinstance(app, FastAPI)
    assert app.state.qali_mode == "mock"
