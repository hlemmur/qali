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


def test_live_runtime_composes_durable_adapters_from_explicit_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = InMemoryJobRepository()
    tasks = InMemoryTaskDispatcher()
    firestore_settings = []
    cloud_tasks_settings = []

    def create_jobs(settings: object) -> InMemoryJobRepository:
        firestore_settings.append(settings)
        return jobs

    def create_tasks(settings: object) -> InMemoryTaskDispatcher:
        cloud_tasks_settings.append(settings)
        return tasks

    monkeypatch.setattr(
        "app.slack_app.create_firestore_job_repository",
        create_jobs,
        raising=False,
    )
    monkeypatch.setattr(
        "app.slack_app.create_cloud_tasks_dispatcher",
        create_tasks,
        raising=False,
    )
    app = create_slack_ingress_app_from_env(
        {
            "QALI_MODE": "live",
            "SLACK_SIGNING_SECRET": "live-signing-secret",
            "SLACK_WORKSPACE_ID": "T-QALI",
            "SLACK_CHANNEL_ID": "C-QALI",
            "SLACK_OWNER_USER_ID": "U-OWNER",
            "GOOGLE_CLOUD_PROJECT": "qali-507317",
            "FIRESTORE_DATABASE_ID": "(default)",
            "FIRESTORE_JOBS_COLLECTION": "jobs",
            "CLOUD_TASKS_LOCATION": "europe-west1",
            "CLOUD_TASKS_QUEUE_ID": "qali-jobs",
            "QALI_WORKER_URL": "https://qali-worker.example.test/internal/jobs",
            "QALI_WORKER_OIDC_AUDIENCE": "https://qali-worker.example.test",
            "QALI_TASKS_SERVICE_ACCOUNT_EMAIL": (
                "qali-tasks@qali-507317.iam.gserviceaccount.com"
            ),
        }
    )

    assert isinstance(app, FastAPI)
    assert app.state.qali_mode == "live"
    assert [settings.model_dump(mode="json") for settings in firestore_settings] == [
        {
            "project_id": "qali-507317",
            "database_id": "(default)",
            "collection": "jobs",
        }
    ]
    assert [settings.model_dump(mode="json") for settings in cloud_tasks_settings] == [
        {
            "project_id": "qali-507317",
            "location": "europe-west1",
            "queue_id": "qali-jobs",
            "worker_url": "https://qali-worker.example.test/internal/jobs",
            "oidc_audience": "https://qali-worker.example.test/",
            "service_account_email": ("qali-tasks@qali-507317.iam.gserviceaccount.com"),
        }
    ]
