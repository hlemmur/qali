from __future__ import annotations

import re

from app.source_fetcher import FetchedSource
from app.source_screening import (
    SourceScreeningDecision,
    SourceScreeningStage,
    SourceThreat,
)
from app.source_text_extraction import SourceTextExtractor

_SCANNER_ID = "qali-deterministic-instruction-v1"
_INSTRUCTION_PATTERNS = (
    re.compile(
        r"\b(?:ignore|disregard|forget|override|bypass)\b.{0,80}"
        r"\b(?:instructions?|polic(?:y|ies)|rules?|system\s+prompts?)\b"
    ),
    re.compile(r"\bfollow\s+(?:these|my|the\s+following)\s+instructions?\s+instead\b"),
    re.compile(
        r"\b(?:reveal|print|expose|return|send)\b.{0,80}"
        r"\b(?:credentials?|secrets?|api\s+keys?|tokens?|passwords?|"
        r"system\s+prompts?)\b"
    ),
)


class DeterministicInstructionScanner:
    def __init__(self) -> None:
        self._extractor = SourceTextExtractor()

    async def scan(self, source: FetchedSource) -> SourceScreeningDecision:
        text = self._extractor.extract_content(
            source_id="screening-source",
            content_type=source.content_type,
            content=source.content,
        ).text
        threats = (
            (SourceThreat.PROMPT_INJECTION,)
            if any(pattern.search(text.casefold()) for pattern in _INSTRUCTION_PATTERNS)
            else ()
        )
        return SourceScreeningDecision(
            stage=SourceScreeningStage.INSTRUCTION,
            scanner=_SCANNER_ID,
            threats=threats,
        )


__all__ = ["DeterministicInstructionScanner"]
