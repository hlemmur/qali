from __future__ import annotations

from collections.abc import Mapping

from fastapi import FastAPI
from fastapi.routing import APIRoute

from app.feature_worker_runtime import create_feature_worker_runtime_from_env
from app.onboarding_runtime import create_onboarding_runtime_from_env


def create_worker_runtime(*, onboarding: FastAPI, feature: FastAPI) -> FastAPI:
    """Expose both authenticated worker surfaces from one application process."""

    app = FastAPI(
        title="Qali worker",
        description="Receives onboarding, feature, and finding jobs from Cloud Tasks.",
    )
    registered: set[tuple[str, str]] = set()
    for child in (onboarding, feature):
        for route in child.routes:
            if not isinstance(route, APIRoute):
                continue
            route_keys = {(route.path, method) for method in (route.methods or set())}
            if registered.intersection(route_keys):
                raise ValueError("duplicate worker route")
            registered.update(route_keys)
            app.router.routes.append(route)

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {
            "status": "ok",
            "mode": "live",
            "workers": "onboarding,feature",
        }

    app.state.qali_mode = "live"
    return app


def create_worker_runtime_from_env(
    environ: Mapping[str, str] | None = None,
) -> FastAPI:
    """Compose both production workers from one validated environment."""

    return create_worker_runtime(
        onboarding=create_onboarding_runtime_from_env(environ),
        feature=create_feature_worker_runtime_from_env(environ),
    )


__all__ = ["create_worker_runtime", "create_worker_runtime_from_env"]
