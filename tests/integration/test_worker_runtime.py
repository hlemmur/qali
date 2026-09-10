import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app import worker_runtime
from app.worker_runtime import create_worker_runtime


@pytest.mark.anyio
async def test_unified_worker_exposes_onboarding_and_feature_routes() -> None:
    onboarding = FastAPI()
    feature = FastAPI()

    @onboarding.post("/internal/jobs")
    async def onboarding_job() -> dict[str, str]:
        return {"worker": "onboarding"}

    @feature.post("/internal/feature-jobs")
    async def feature_job() -> dict[str, str]:
        return {"worker": "feature"}

    app = create_worker_runtime(onboarding=onboarding, feature=feature)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://worker.test",
    ) as client:
        onboarding_response = await client.post("/internal/jobs")
        feature_response = await client.post("/internal/feature-jobs")
        health_response = await client.get("/healthz")

    assert onboarding_response.json() == {"worker": "onboarding"}
    assert feature_response.json() == {"worker": "feature"}
    assert health_response.json() == {
        "status": "ok",
        "mode": "live",
        "workers": "onboarding,feature",
    }


def test_unified_worker_rejects_overlapping_job_routes() -> None:
    onboarding = FastAPI()
    feature = FastAPI()

    @onboarding.post("/internal/jobs")
    async def onboarding_job() -> None:
        return None

    @feature.post("/internal/jobs")
    async def feature_job() -> None:
        return None

    with pytest.raises(ValueError, match="duplicate worker route"):
        create_worker_runtime(onboarding=onboarding, feature=feature)


def test_live_worker_factory_composes_both_runtime_factories(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = {"QALI_MODE": "live"}
    calls: list[tuple[str, object]] = []

    def create_onboarding(environ: object) -> FastAPI:
        calls.append(("onboarding", environ))
        app = FastAPI()
        app.post("/internal/jobs")(lambda: None)
        return app

    def create_feature(environ: object) -> FastAPI:
        calls.append(("feature", environ))
        app = FastAPI()
        app.post("/internal/feature-jobs")(lambda: None)
        return app

    monkeypatch.setattr(
        worker_runtime,
        "create_onboarding_runtime_from_env",
        create_onboarding,
    )
    monkeypatch.setattr(
        worker_runtime,
        "create_feature_worker_runtime_from_env",
        create_feature,
    )

    app = worker_runtime.create_worker_runtime_from_env(environment)

    assert calls == [
        ("onboarding", environment),
        ("feature", environment),
    ]
    assert app.state.qali_mode == "live"
