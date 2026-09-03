from __future__ import annotations

from app.onboarding_source_extraction import extract_onboarding_sources
from app.slack_ingress import OnboardProjectJob


def test_slack_onboarding_text_and_links_become_typed_sources() -> None:
    job = OnboardProjectJob(
        job_id="slack:Ev-source-extraction",
        source_event_id="Ev-source-extraction",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788458400.001000",
        request_text=(
            "<@U-QALI> onboard project "
            "Customers can edit their profile. "
            "Use <https://docs.example.test/profile?version=2|the product guide>."
        ),
    )

    sources = extract_onboarding_sources(job)

    assert sources.author_ref == "slack:U-OWNER"
    assert sources.text is not None
    assert sources.text.content == "Customers can edit their profile. Use."
    assert sources.text.source_id.startswith("slack-text-")
    assert len(sources.urls) == 1
    assert sources.urls[0].url == "https://docs.example.test/profile?version=2"
    assert sources.urls[0].source_id.startswith("slack-url-")


def test_duplicate_urls_are_deduplicated_with_retry_stable_ids() -> None:
    job = OnboardProjectJob(
        job_id="slack:Ev-retry",
        source_event_id="Ev-retry",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788458400.002000",
        request_text=(
            "<@U-QALI> onboard project "
            "https://docs.example.test/one, "
            "<https://docs.example.test/two|two> "
            "https://docs.example.test/one"
        ),
    )

    first = extract_onboarding_sources(job)
    retry = extract_onboarding_sources(job)

    assert first == retry
    assert [source.url for source in first.urls] == [
        "https://docs.example.test/one",
        "https://docs.example.test/two",
    ]
    assert first.text is None


def test_http_links_remain_text_and_are_not_fetchable_sources() -> None:
    job = OnboardProjectJob(
        job_id="slack:Ev-http",
        source_event_id="Ev-http",
        workspace_id="T-QALI",
        channel_id="C-QALI",
        requester_user_id="U-OWNER",
        thread_ts="1788458400.003000",
        request_text="<@U-QALI> onboard project See http://unsafe.example.test.",
    )

    sources = extract_onboarding_sources(job)

    assert sources.urls == ()
    assert sources.text is not None
    assert sources.text.content == "See http://unsafe.example.test."
