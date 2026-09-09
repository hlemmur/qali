from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Protocol

from app.project_projection_repository import PublishedProjectProjections
from app.project_projections import (
    ProjectProjectionBundle,
    ProjectRunAuditEvent,
    compile_project_projections,
)
from app.run_artifact_repository import StoredRunPointer
from app.run_artifacts import RunArtifactDocument
from app.run_record_loader import FeatureRunRecordLoader


class RunHistoryRepository(Protocol):
    async def list_runs(self, project_id: str) -> tuple[StoredRunPointer, ...]: ...

    async def read(self, object_name: str) -> RunArtifactDocument: ...


class ProjectionRepository(Protocol):
    async def current_generations(self, project_id: str) -> dict[str, int]: ...

    async def publish(
        self,
        bundle: ProjectProjectionBundle,
        *,
        expected_generations: Mapping[str, int],
    ) -> PublishedProjectProjections: ...


class ProjectProjectionUpdater:
    def __init__(
        self,
        *,
        history: RunHistoryRepository,
        projections: ProjectionRepository,
    ) -> None:
        self._history = history
        self._projections = projections

    async def refresh(self, project_id: str) -> PublishedProjectProjections:
        pointers = await self._history.list_runs(project_id)
        if not pointers:
            raise ValueError("project projection requires persisted run history")
        loader = FeatureRunRecordLoader(artifacts=self._history)
        records = await asyncio.gather(
            *(loader.load(pointer.project_id, pointer.run_id) for pointer in pointers)
        )
        bundle = compile_project_projections(
            tuple(
                ProjectRunAuditEvent(record=record, completed_at=pointer.created_at)
                for pointer, record in zip(pointers, records, strict=True)
            )
        )
        generations = await self._projections.current_generations(project_id)
        return await self._projections.publish(
            bundle,
            expected_generations=generations,
        )


__all__ = ["ProjectProjectionUpdater", "ProjectionRepository", "RunHistoryRepository"]
