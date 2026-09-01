import tomllib
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _env_example() -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in (ROOT / ".env.example").read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def test_scaffold_metadata_matches_approved_architecture() -> None:
    manifest = yaml.safe_load((ROOT / "agents-cli-manifest.yaml").read_text())

    assert manifest["base_template"] == "adk"
    assert manifest["region"] == "europe-west1"
    assert manifest["create_params"]["deployment_target"] == "none"
    assert manifest["create_params"]["cicd_runner"] == "skip"


def test_local_example_uses_free_gemini_developer_api() -> None:
    env = _env_example()

    assert env["GOOGLE_GENAI_USE_VERTEXAI"] == "false"
    assert env["GEMINI_API_KEY"] == "your-api-key-here"
    assert env["GOOGLE_CLOUD_PROJECT"] == "qali-507317"
    assert env["GOOGLE_CLOUD_LOCATION"] == "europe-west1"


def test_quality_gate_excludes_external_skill_catalog() -> None:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())

    assert ".agents" in config["tool"]["ruff"]["extend-exclude"]
    assert ".agents/**" in config["tool"]["ty"]["src"]["exclude"]
    assert ".agents" in config["tool"]["codespell"]["skip"].split(",")
