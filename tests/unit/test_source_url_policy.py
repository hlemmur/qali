import pytest

from app.source_url_policy import SourceUrlPolicy


def test_approved_https_source_url_is_normalized() -> None:
    policy = SourceUrlPolicy(allowed_origins={"https://docs.example.test"})

    source_url = policy.validate("https://DOCS.example.test/guide?version=2")

    assert source_url == "https://docs.example.test/guide?version=2"


def test_source_url_rejects_embedded_credentials() -> None:
    policy = SourceUrlPolicy(allowed_origins={"https://docs.example.test"})

    with pytest.raises(ValueError, match="credentials"):
        policy.validate("https://owner:secret@docs.example.test/guide")


@pytest.mark.parametrize(
    "source_url",
    [
        "https://127.0.0.1/admin",
        "https://10.0.0.1/admin",
        "https://[::1]/admin",
        "https://169.254.169.254/computeMetadata/v1/",
        "https://metadata.google.internal/computeMetadata/v1/",
    ],
)
def test_source_url_rejects_non_public_targets(source_url: str) -> None:
    origin = source_url.rsplit("/", 1)[0]
    policy = SourceUrlPolicy(allowed_origins={origin})

    with pytest.raises(ValueError, match="public"):
        policy.validate(source_url)


def test_source_url_rejects_private_resolved_address() -> None:
    policy = SourceUrlPolicy(allowed_origins={"https://docs.example.test"})

    with pytest.raises(ValueError, match="public"):
        policy.validate(
            "https://docs.example.test/guide",
            resolved_addresses=["10.0.0.8"],
        )


def test_source_url_requires_https() -> None:
    policy = SourceUrlPolicy(allowed_origins={"https://docs.example.test"})

    with pytest.raises(ValueError, match="HTTPS"):
        policy.validate("http://docs.example.test/guide")


def test_source_url_requires_exact_approved_origin() -> None:
    policy = SourceUrlPolicy(allowed_origins={"https://docs.example.test"})

    with pytest.raises(ValueError, match="approved"):
        policy.validate("https://example.test/guide")
