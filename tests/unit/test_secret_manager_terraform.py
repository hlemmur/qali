from pathlib import Path

TERRAFORM_ROOT = Path("deployment/terraform/single-project")


def test_runtime_secrets_are_preprovisioned_references_without_values() -> None:
    apis = (TERRAFORM_ROOT / "apis.tf").read_text()
    variables = (TERRAFORM_ROOT / "variables.tf").read_text()
    secrets = (TERRAFORM_ROOT / "secrets.tf").read_text()

    assert '"secretmanager.googleapis.com"' in apis
    assert 'variable "slack_signing_secret_id"' in variables
    assert 'variable "slack_bot_token_secret_id"' in variables
    assert 'variable "gemini_api_key_secret_id"' in variables
    assert 'data "google_secret_manager_secret" "slack_signing"' in secrets
    assert 'data "google_secret_manager_secret" "slack_bot_token"' in secrets
    assert 'data "google_secret_manager_secret" "gemini_api_key"' in secrets
    assert "google_secret_manager_secret_version" not in secrets
    assert "secret_data" not in secrets


def test_static_secret_access_is_identity_and_secret_scoped() -> None:
    secrets = (TERRAFORM_ROOT / "secrets.tf").read_text()

    signing_access = secrets.split(
        'resource "google_secret_manager_secret_iam_member" "ingress_signing_access"',
        1,
    )[1].split(
        'resource "google_secret_manager_secret_iam_member" "worker_slack_access"',
        1,
    )[0]
    slack_access = secrets.split(
        'resource "google_secret_manager_secret_iam_member" "worker_slack_access"',
        1,
    )[1].split(
        'resource "google_secret_manager_secret_iam_member" "worker_gemini_access"',
        1,
    )[0]
    gemini_access = secrets.split(
        'resource "google_secret_manager_secret_iam_member" "worker_gemini_access"',
        1,
    )[1]

    assert 'role      = "roles/secretmanager.secretAccessor"' in signing_access
    assert "google_service_account.ingress_sa.email" in signing_access
    assert "google_service_account.worker_sa.email" not in signing_access
    assert "data.google_secret_manager_secret.slack_signing.secret_id" in signing_access

    assert 'role      = "roles/secretmanager.secretAccessor"' in slack_access
    assert "google_service_account.worker_sa.email" in slack_access
    assert "google_service_account.ingress_sa.email" not in slack_access
    assert "data.google_secret_manager_secret.slack_bot_token.secret_id" in slack_access

    assert 'role      = "roles/secretmanager.secretAccessor"' in gemini_access
    assert "google_service_account.worker_sa.email" in gemini_access
    assert "google_service_account.ingress_sa.email" not in gemini_access
    assert "data.google_secret_manager_secret.gemini_api_key.secret_id" in gemini_access

    assert "roles/secretmanager.admin" not in secrets
    assert "google_project_iam" not in secrets


def test_cloud_run_receives_only_the_secrets_each_service_needs() -> None:
    service = (TERRAFORM_ROOT / "service.tf").read_text()
    ingress = service.split('resource "google_cloud_run_v2_service" "ingress"', 1)[
        1
    ].split('resource "google_cloud_run_v2_service" "worker"', 1)[0]
    worker = service.split('resource "google_cloud_run_v2_service" "worker"', 1)[1]

    assert 'name = "SLACK_SIGNING_SECRET"' in ingress
    assert "data.google_secret_manager_secret.slack_signing.secret_id" in ingress
    assert 'version = "latest"' in ingress
    assert "SLACK_BOT_TOKEN" not in ingress
    assert "GEMINI_API_KEY" not in ingress

    assert 'name = "SLACK_BOT_TOKEN"' in worker
    assert "data.google_secret_manager_secret.slack_bot_token.secret_id" in worker
    assert 'name = "GEMINI_API_KEY"' in worker
    assert "data.google_secret_manager_secret.gemini_api_key.secret_id" in worker
    assert worker.count('version = "latest"') == 2
    assert "SLACK_SIGNING_SECRET" not in worker

    assert "secret_data" not in service


def test_target_credentials_require_an_explicit_worker_only_allowlist() -> None:
    variables = (TERRAFORM_ROOT / "variables.tf").read_text()
    secrets = (TERRAFORM_ROOT / "secrets.tf").read_text()

    assert 'variable "target_credential_secret_ids"' in variables
    target_access = secrets.split(
        'resource "google_secret_manager_secret_iam_member" "worker_target_access"',
        1,
    )[1]

    assert "for_each  = toset(var.target_credential_secret_ids)" in target_access
    assert "secret_id = each.value" in target_access
    assert 'role      = "roles/secretmanager.secretAccessor"' in target_access
    assert "google_service_account.worker_sa.email" in target_access
    assert "google_service_account.ingress_sa.email" not in target_access
    assert "roles/secretmanager.admin" not in target_access


def test_deployment_guide_requires_preprovisioned_versions_without_values() -> None:
    readme = " ".join(Path("README.md").read_text().split())

    assert "Secret Manager preflight" in readme
    assert "active version" in readme
    assert "outside Terraform" in readme
    assert "target_credential_secret_ids" in readme
    assert "Never place secret values" in readme


def test_static_secret_inputs_accept_only_same_project_ids() -> None:
    variables = (TERRAFORM_ROOT / "variables.tf").read_text()

    for variable_name in (
        "slack_signing_secret_id",
        "slack_bot_token_secret_id",
        "gemini_api_key_secret_id",
    ):
        block = variables.split(f'variable "{variable_name}"', 1)[1].split("\n}\n", 1)[
            0
        ]
        assert f'can(regex("^[A-Za-z0-9_-]+$", var.{variable_name}))' in block
