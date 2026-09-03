from __future__ import annotations

import hashlib
import re

from pydantic import BaseModel, ConfigDict, Field

from app.slack_ingress import OnboardProjectJob

_COMMAND_PREFIX = re.compile(
    r"^\s*<@[^>]+>\s+onboard\s+project\b\s*",
    re.IGNORECASE,
)
_HTTPS_LINK = re.compile(
    r"<(?P<slack>https://[^<>\s|]+)(?:\|[^<>]*)?>"
    r"|(?P<plain>https://[^\s<>()]+)",
    re.IGNORECASE,
)
_TRAILING_URL_PUNCTUATION = ".,;:!?"


class SlackTextSource(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    source_id: str = Field(min_length=1)
    content: str = Field(min_length=1)


class SlackUrlSource(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    source_id: str = Field(min_length=1)
    url: str = Field(min_length=1)


class ExtractedOnboardingSources(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    author_ref: str = Field(min_length=1)
    text: SlackTextSource | None
    urls: tuple[SlackUrlSource, ...]


def extract_onboarding_sources(job: OnboardProjectJob) -> ExtractedOnboardingSources:
    request_text = _COMMAND_PREFIX.sub("", job.request_text, count=1)
    extracted_urls: list[str] = []

    def remove_link(match: re.Match[str]) -> str:
        url = match.group("slack") or match.group("plain")
        if match.group("plain") is not None:
            url = url.rstrip(_TRAILING_URL_PUNCTUATION)
            trailing = match.group("plain")[len(url) :]
        else:
            trailing = ""
        if url not in extracted_urls:
            extracted_urls.append(url)
        return trailing

    residual_text = _HTTPS_LINK.sub(remove_link, request_text)
    residual_text = re.sub(r"\s+", " ", residual_text)
    residual_text = re.sub(r"\s+([.,;:!?])", r"\1", residual_text).strip()

    text_source = None
    if residual_text.strip(_TRAILING_URL_PUNCTUATION):
        text_source = SlackTextSource(
            source_id=_source_id(job.source_event_id, "text", prefix="slack-text"),
            content=residual_text,
        )

    urls = tuple(
        SlackUrlSource(
            source_id=_source_id(job.source_event_id, url, prefix="slack-url"),
            url=url,
        )
        for url in extracted_urls
    )
    return ExtractedOnboardingSources(
        author_ref=f"slack:{job.requester_user_id}",
        text=text_source,
        urls=urls,
    )


def _source_id(event_id: str, value: str, *, prefix: str) -> str:
    digest = hashlib.sha256(f"{event_id}\0{value}".encode()).hexdigest()[:32]
    return f"{prefix}-{digest}"


__all__ = [
    "ExtractedOnboardingSources",
    "SlackTextSource",
    "SlackUrlSource",
    "extract_onboarding_sources",
]
