from __future__ import annotations

from typing import Any

import pytest

from app.slack_file_client import (
    AiohttpSlackDownloadTransport,
    SlackApiFileClient,
    SlackFileClientSettings,
    SlackFileUnavailable,
)
from app.slack_file_fetcher import SlackFilePayload


class _SlackMetadataClient:
    async def files_info(self, *, file: str, **kwargs: Any) -> dict[str, object]:
        assert file == "F-PROFILE"
        assert kwargs == {}
        return {
            "ok": True,
            "file": {
                "id": file,
                "name": "profile.md",
                "mimetype": "text/markdown",
                "size": 48,
                "url_private_download": "https://files.slack.com/files-pri/T/F/profile.md",
            },
        }


class _SlackDownloadTransport:
    async def get(
        self,
        url: str,
        *,
        bearer_token: str,
        max_bytes: int,
    ) -> bytes:
        assert url == "https://files.slack.com/files-pri/T/F/profile.md"
        assert bearer_token == "xoxb-test-token"
        assert max_bytes == 48
        return b"# Profile\nCustomers can edit their display name."


@pytest.mark.asyncio
async def test_client_resolves_metadata_and_downloads_with_bearer_auth() -> None:
    client = SlackApiFileClient(
        settings=SlackFileClientSettings(token="xoxb-test-token"),
        metadata_client=_SlackMetadataClient(),
        transport=_SlackDownloadTransport(),
    )

    payload = await client.download("F-PROFILE", max_bytes=48)

    assert payload == SlackFilePayload(
        file_id="F-PROFILE",
        name="profile.md",
        media_type="text/markdown",
        size_bytes=48,
        content=b"# Profile\nCustomers can edit their display name.",
    )
    assert "xoxb-test-token" not in repr(client)


class _FailingMetadataClient:
    async def files_info(self, *, file: str, **kwargs: Any) -> dict[str, object]:
        del file, kwargs
        raise RuntimeError("xoxb-sensitive profile.md")


@pytest.mark.asyncio
async def test_client_redacts_slack_api_failures() -> None:
    client = SlackApiFileClient(
        settings=SlackFileClientSettings(token="xoxb-test-token"),
        metadata_client=_FailingMetadataClient(),
        transport=_SlackDownloadTransport(),
    )

    with pytest.raises(SlackFileUnavailable) as caught:
        await client.download("F-PROFILE", max_bytes=48)

    assert str(caught.value) == "Slack file is unavailable"
    assert "xoxb" not in str(caught.value)
    assert "profile.md" not in str(caught.value)


@pytest.mark.asyncio
async def test_transport_rejects_non_slack_origin_before_sending_bearer() -> None:
    with pytest.raises(SlackFileUnavailable):
        await AiohttpSlackDownloadTransport().get(
            "https://attacker.example/files-pri/T/F/profile.md",
            bearer_token="xoxb-test-token",
            max_bytes=48,
        )
