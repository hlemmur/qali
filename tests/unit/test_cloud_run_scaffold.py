from pathlib import Path

import yaml


def test_generated_cloud_run_baseline_is_private_free_tier_and_scale_to_zero() -> None:
    manifest = yaml.safe_load(Path("agents-cli-manifest.yaml").read_text())
    service = Path("deployment/terraform/single-project/service.tf").read_text()
    apis = Path("deployment/terraform/single-project/apis.tf").read_text()
    iam = Path("deployment/terraform/single-project/iam.tf").read_text()
    providers = Path("deployment/terraform/single-project/providers.tf").read_text()

    assert manifest["region"] == "europe-west1"
    assert manifest["create_params"]["deployment_target"] == "cloud_run"
    assert manifest["create_params"]["cicd_runner"] == "skip"

    assert 'ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"' in service
    assert 'name  = "GOOGLE_GENAI_USE_VERTEXAI"' in service
    model_env = service.split('name  = "GOOGLE_GENAI_USE_VERTEXAI"', 1)[1].split(
        "}", 1
    )[0]
    assert 'value = "false"' in model_env
    assert "max_instance_request_concurrency = 1" in service
    assert "min_instance_count = 0" in service
    assert "max_instance_count = 1" in service
    assert "session_affinity = false" in service
    assert 'value = "NO_CONTENT"' in service
    assert 'value = "false"' in service

    forbidden = (
        "aiplatform.googleapis.com",
        "bigquery.googleapis.com",
        "roles/aiplatform.user",
        "roles/storage.admin",
        "default_compute_sa_storage_object_creator",
        "OTEL_INSTRUMENTATION_GENAI_COMPLETION_HOOK",
        "OTEL_INSTRUMENTATION_GENAI_UPLOAD_BASE_PATH",
    )
    combined = "\n".join((service, apis, iam))
    assert all(value not in combined for value in forbidden)
    assert not Path("deployment/terraform/single-project/telemetry.tf").exists()
    assert not Path("tests/eval/datasets/basic-dataset.json").exists()
    assert not Path("tests/eval/response_quality.py").exists()
    assert 'provider "google" {' in providers
    assert "alias" not in providers
    assert "project               = var.project_id" in providers


def test_terraform_runtime_artifacts_are_ignored() -> None:
    gitignore = Path(".gitignore").read_text().splitlines()

    assert ".terraform/" in gitignore
    assert ".terraform.lock.hcl" not in gitignore
    assert "*.tfstate" in gitignore
    assert "*.tfstate.*" in gitignore
    assert "*.tfplan" in gitignore
