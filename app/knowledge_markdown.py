from __future__ import annotations

import hashlib
import html
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.knowledge_quality import (
    KnowledgeCompilation,
    KnowledgeQualityDecision,
)

_CITATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_MARKDOWN_INLINE = re.compile(r"([\\`*_\[\]#|])")


class CompiledKnowledgeDocument(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    project_id: str
    content_type: Literal["text/markdown"] = "text/markdown"
    content: bytes
    sha256: str


def compile_knowledge_markdown(
    compilation: KnowledgeCompilation,
    decision: KnowledgeQualityDecision,
) -> CompiledKnowledgeDocument:
    lines = [
        "# Project Knowledge",
        "",
        f"Readiness: {decision.readiness.value}",
        f"Confidence: {compilation.confidence.value}",
        "",
        "## Overview",
        "",
        _safe_text(compilation.overview),
        "",
        "## Facts",
        "",
    ]
    lines.extend(
        _render_cited_item(fact.statement, fact.source_ids)
        for fact in compilation.facts
    )
    if not compilation.facts:
        lines.append("- None recorded.")

    lines.extend(("", "## Contradictions", ""))
    lines.extend(
        _render_cited_item(item.description, item.source_ids)
        for item in compilation.contradictions
    )
    if not compilation.contradictions:
        lines.append("- None recorded.")

    lines.extend(("", "## Gaps", ""))
    lines.extend(
        f"- [{'blocking' if gap.blocking else 'non-blocking'}] "
        f"{_safe_text(gap.description)}"
        for gap in compilation.gaps
    )
    if not compilation.gaps:
        lines.append("- None recorded.")

    lines.extend(("", "## Readiness reasons", ""))
    lines.extend(f"- {reason.value}" for reason in decision.reasons)
    if not decision.reasons:
        lines.append("- None.")

    content = ("\n".join(lines) + "\n").encode()
    return CompiledKnowledgeDocument(
        project_id=compilation.project_id,
        content=content,
        sha256=hashlib.sha256(content).hexdigest(),
    )


def _render_cited_item(text: str, source_ids: tuple[str, ...]) -> str:
    citations = ", ".join(f"`{_citation_id(value)}`" for value in source_ids)
    return f"- {_safe_text(text)} — Sources: {citations}"


def _citation_id(value: str) -> str:
    if _CITATION_ID.fullmatch(value) is None:
        raise ValueError("knowledge citation identifier is invalid")
    return value


def _safe_text(value: str) -> str:
    normalized = " ".join(value.split())
    escaped = html.escape(normalized, quote=True)
    return _MARKDOWN_INLINE.sub(r"\\\1", escaped)


__all__ = ["CompiledKnowledgeDocument", "compile_knowledge_markdown"]
