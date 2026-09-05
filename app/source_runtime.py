from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.onboarding_source_flow import OnboardingSourceFlow, ProjectRepository
from app.source_fetcher import (
    BoundedSourceFetcher,
    BoundSourceTransport,
    SourceResolver,
)
from app.source_ingestion import (
    OnboardingSourceIngestionService,
    RawSourceRepository,
    SlackFileFetcher,
    SourceMetadataIndex,
)
from app.source_instruction_scanner import DeterministicInstructionScanner
from app.source_network import AiohttpBoundSourceTransport, SystemSourceResolver
from app.source_screening import SourceContentScanner, SourceScreeningService
from app.source_url_policy import SourceUrlPolicy


class SourceRuntimeSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    allowed_origins: tuple[str, ...] = Field(min_length=1, max_length=20)
    max_bytes: int = Field(default=5_000_000, gt=0, le=20_000_000)
    max_redirects: int = Field(default=3, ge=0, le=5)
    timeout_seconds: float = Field(default=30, gt=0, le=120)
    max_sources: int = Field(default=10, ge=1, le=20)


def create_onboarding_source_flow(
    *,
    settings: SourceRuntimeSettings,
    projects: ProjectRepository,
    malware_scanner: SourceContentScanner,
    raw_repository: RawSourceRepository,
    source_index: SourceMetadataIndex,
    resolver: SourceResolver | None = None,
    transport: BoundSourceTransport | None = None,
    file_fetcher: SlackFileFetcher | None = None,
) -> OnboardingSourceFlow:
    """Compose bounded fetch, mandatory screening, and durable source ingestion."""

    fetcher = BoundedSourceFetcher(
        policy=SourceUrlPolicy(allowed_origins=set(settings.allowed_origins)),
        resolver=resolver or SystemSourceResolver(),
        transport=transport
        or AiohttpBoundSourceTransport(timeout_seconds=settings.timeout_seconds),
        max_bytes=settings.max_bytes,
        max_redirects=settings.max_redirects,
    )
    screening = SourceScreeningService(
        malware_scanner=malware_scanner,
        instruction_scanner=DeterministicInstructionScanner(),
    )
    ingestion = OnboardingSourceIngestionService(
        fetcher=fetcher,
        screener=screening,
        raw_repository=raw_repository,
        source_index=source_index,
        file_fetcher=file_fetcher,
    )
    return OnboardingSourceFlow(
        projects=projects,
        ingestion=ingestion,
        max_sources=settings.max_sources,
    )


__all__ = ["SourceRuntimeSettings", "create_onboarding_source_flow"]
