from pathlib import Path

import yaml


def test_cloud_run_topology_uses_slack_ingress_and_unified_worker() -> None:
    service = Path("deployment/terraform/single-project/service.tf").read_text()
    variables = Path("deployment/terraform/single-project/variables.tf").read_text()

    assert service.count('resource "google_cloud_run_v2_service"') == 2
    assert 'resource "google_cloud_run_v2_service" "ingress"' in service
    assert 'resource "google_cloud_run_v2_service" "worker"' in service
    assert 'resource "google_cloud_run_v2_service" "app"' not in service
    assert "app.slack_app:create_slack_ingress_app_from_env" in service
    assert "app.worker_runtime:create_worker_runtime_from_env" in service
    assert service.count("var.container_image") == 2
    assert "cloudrun/container/hello" not in service
    assert 'variable "container_image"' in variables


def test_cloud_run_services_use_distinct_runtime_identities() -> None:
    service = Path("deployment/terraform/single-project/service.tf").read_text()
    iam = Path("deployment/terraform/single-project/iam.tf").read_text()
    variables = Path("deployment/terraform/single-project/variables.tf").read_text()

    assert 'resource "google_service_account" "ingress_sa"' in iam
    assert 'resource "google_service_account" "worker_sa"' in iam
    assert 'resource "google_service_account" "app_sa"' not in iam
    assert "google_service_account.ingress_sa.email" in service
    assert "google_service_account.worker_sa.email" in service
    assert 'variable "ingress_sa_roles"' in variables
    assert 'variable "worker_sa_roles"' in variables


def test_cloud_run_requires_an_immutable_container_digest() -> None:
    variables = Path("deployment/terraform/single-project/variables.tf").read_text()

    image_variable = variables.split('variable "container_image"', 1)[1].split(
        'variable "ingress_sa_roles"', 1
    )[0]
    assert "validation" in image_variable
    assert "@sha256:[0-9a-f]{64}$" in image_variable


def test_generated_cloud_run_baseline_is_private_free_tier_and_scale_to_zero() -> None:
    manifest = yaml.safe_load(Path("agents-cli-manifest.yaml").read_text())
    service = Path("deployment/terraform/single-project/service.tf").read_text()
    apis = Path("deployment/terraform/single-project/apis.tf").read_text()
    iam = Path("deployment/terraform/single-project/iam.tf").read_text()
    providers = Path("deployment/terraform/single-project/providers.tf").read_text()
    ingress = service.split('resource "google_cloud_run_v2_service" "ingress"', 1)[
        1
    ].split('resource "google_cloud_run_v2_service" "worker"', 1)[0]
    worker = service.split('resource "google_cloud_run_v2_service" "worker"', 1)[1]

    assert manifest["region"] == "europe-west1"
    assert manifest["create_params"]["deployment_target"] == "cloud_run"
    assert manifest["create_params"]["cicd_runner"] == "skip"

    assert 'ingress             = "INGRESS_TRAFFIC_ALL"' in ingress
    assert 'ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"' in worker
    assert 'name  = "GOOGLE_GENAI_USE_VERTEXAI"' not in ingress
    assert 'name  = "GOOGLE_GENAI_USE_VERTEXAI"' in worker
    model_env = worker.split('name  = "GOOGLE_GENAI_USE_VERTEXAI"', 1)[1].split("}", 1)[
        0
    ]
    assert 'value = "false"' in model_env
    assert "max_instance_request_concurrency = 8" in ingress
    assert "min_instance_count = 0" in ingress
    assert "max_instance_count = 2" in ingress
    assert "max_instance_request_concurrency = 1" in worker
    assert "min_instance_count = 0" in worker
    assert "max_instance_count = 1" in worker
    assert "session_affinity = false" in ingress
    assert "session_affinity = false" in worker
    assert 'value = "NO_CONTENT"' in worker
    assert 'value = "false"' in worker

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
