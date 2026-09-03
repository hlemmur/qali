from __future__ import annotations

from enum import StrEnum
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.source_fetcher import FetchedSource


class SourceThreat(StrEnum):
    MALWARE = "malware"
    PROMPT_INJECTION = "prompt_injection"


class SourceScreeningDecision(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    scanner: str = Field(min_length=1)
    threats: tuple[SourceThreat, ...]


class ScreenedSource(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    source: FetchedSource
    decisions: tuple[SourceScreeningDecision, ...]


class SourceContentScanner(Protocol):
    async def scan(self, source: FetchedSource) -> SourceScreeningDecision: ...


class SourceScreeningRejected(ValueError):
    def __init__(self, decisions: tuple[SourceScreeningDecision, ...]) -> None:
        super().__init__("source rejected by screening policy")
        self.decisions = decisions


class SourceScreeningUnavailable(RuntimeError):
    def __init__(self, stage: Literal["malware", "instruction"]) -> None:
        super().__init__("source screening is unavailable")
        self.stage = stage


class SourceScreeningService:
    def __init__(
        self,
        *,
        malware_scanner: SourceContentScanner,
        instruction_scanner: SourceContentScanner,
    ) -> None:
        self._malware_scanner = malware_scanner
        self._instruction_scanner = instruction_scanner

    async def screen(self, source: FetchedSource) -> ScreenedSource:
        decisions: list[SourceScreeningDecision] = []
        stages: tuple[
            tuple[Literal["malware", "instruction"], SourceContentScanner], ...
        ] = (
            ("malware", self._malware_scanner),
            ("instruction", self._instruction_scanner),
        )
        for stage, scanner in stages:
            try:
                decision = await scanner.scan(source)
            except Exception:
                raise SourceScreeningUnavailable(stage) from None
            decisions.append(decision)
            if decision.threats:
                raise SourceScreeningRejected(tuple(decisions))
        return ScreenedSource(source=source, decisions=tuple(decisions))


__all__ = [
    "ScreenedSource",
    "SourceContentScanner",
    "SourceScreeningDecision",
    "SourceScreeningRejected",
    "SourceScreeningService",
    "SourceScreeningUnavailable",
    "SourceThreat",
]
