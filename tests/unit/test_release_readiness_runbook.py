from pathlib import Path


def test_release_runbook_keeps_live_qualification_fail_closed() -> None:
    runbook = " ".join(Path("docs/release-readiness.md").read_text().split())

    required_evidence = (
        "Current decision: **NO-GO**",
        "two consecutive core eval runs score at least 90%",
        "held-out eval scores at least 85%",
        "two clean isolated SauceDemo cart runs",
        "one intentionally failing oracle path",
        "Slack onboarding, feature test, and finding follow-up",
        "Cloud Trace",
        "Explicit owner approval",
        "Rollback triggers",
        "Rollback procedure",
        "Post-deployment verification",
    )

    assert all(item in runbook for item in required_evidence)
    assert "GOOGLE_API_KEY=" not in runbook
    assert "SLACK_BOT_TOKEN=" not in runbook
