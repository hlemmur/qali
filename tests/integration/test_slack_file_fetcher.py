from __future__ import annotations

import hashlib

import pytest

from app.slack_file_fetcher import (
    BoundedSlackFileFetcher,
    SlackFileIntegrityError,
    SlackFilePayload,
)
from app.slack_ingress import SlackFileReference


class _SlackFileClient:
    async def download(self, file_id: str, *, max_bytes: int) -> SlackFilePayload:
        assert file_id == "F-PROFILE"
        assert max_bytes == 48
        return SlackFilePayload(
            file_id=file_id,
            name="profile.md",
            media_type="text/markdown",
            size_bytes=48,
            content=b"# Profile\nCustomers can edit their display name.",
        )


@pytest.mark.asyncio
async def test_fetcher_returns_bounded_file_with_redacted_source_uri() -> None:
    reference = SlackFileReference(
        file_id="F-PROFILE",
        name="profile.md",
        media_type="text/markdown",
        size_bytes=48,
    )

    source = await BoundedSlackFileFetcher(
        client=_SlackFileClient(),
        max_bytes=4096,
    ).fetch(reference)

    expected_ref = hashlib.sha256(reference.file_id.encode()).hexdigest()
    assert source.url == f"slack-file://{expected_ref}"
    assert source.content_type == "text/markdown"
    assert source.content == b"# Profile\nCustomers can edit their display name."


class _MismatchedSlackFileClient:
    async def download(self, file_id: str, *, max_bytes: int) -> SlackFilePayload:
        del file_id, max_bytes
        return SlackFilePayload(
            file_id="F-OTHER",
            name="profile.md",
            media_type="text/markdown",
            size_bytes=4,
            content=b"evil",
        )


@pytest.mark.asyncio
async def test_fetcher_rejects_changed_slack_file_metadata() -> None:
    reference = SlackFileReference(
        file_id="F-PROFILE",
        name="profile.md",
        media_type="text/markdown",
        size_bytes=48,
    )

    with pytest.raises(SlackFileIntegrityError) as caught:
        await BoundedSlackFileFetcher(
            client=_MismatchedSlackFileClient(),
            max_bytes=4096,
        ).fetch(reference)

    assert str(caught.value) == "Slack file integrity verification failed"
    assert "F-PROFILE" not in str(caught.value)
    assert "F-OTHER" not in str(caught.value)
