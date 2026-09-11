from pathlib import Path

TERRAFORM_ROOT = Path("deployment/terraform/single-project")


def test_firestore_uses_protected_standard_default_database() -> None:
    apis = (TERRAFORM_ROOT / "apis.tf").read_text()
    firestore = (TERRAFORM_ROOT / "firestore.tf").read_text()

    assert '"firestore.googleapis.com"' in apis
    assert 'resource "google_firestore_database" "qali"' in firestore
    assert 'name        = "(default)"' in firestore
    assert "location_id = var.region" in firestore
    assert 'type             = "FIRESTORE_NATIVE"' in firestore
    assert 'database_edition = "STANDARD"' in firestore
    assert 'concurrency_mode                  = "PESSIMISTIC"' in firestore
    assert 'app_engine_integration_mode       = "DISABLED"' in firestore
    assert (
        'point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"'
        in firestore
    )
    assert 'delete_protection_state = "DELETE_PROTECTION_ENABLED"' in firestore
    assert 'deletion_policy         = "PREVENT"' in firestore


def test_firestore_data_access_is_limited_to_runtime_identities() -> None:
    variables = (TERRAFORM_ROOT / "variables.tf").read_text()
    ingress_roles = variables.split('variable "ingress_sa_roles"', 1)[1].split(
        'variable "worker_sa_roles"', 1
    )[0]
    worker_roles = variables.split('variable "worker_sa_roles"', 1)[1]

    assert '"roles/datastore.user"' in ingress_roles
    assert '"roles/datastore.user"' in worker_roles
    assert "roles/datastore.owner" not in variables
    assert "roles/datastore.importExportAdmin" not in variables


def test_firestore_deletion_audit_expires_by_timestamp_ttl() -> None:
    firestore = (TERRAFORM_ROOT / "firestore.tf").read_text()

    ttl = firestore.split(
        'resource "google_firestore_field" "deletion_audit_expiry"', 1
    )[1]
    assert "project    = var.project_id" in ttl
    assert "database   = google_firestore_database.qali.name" in ttl
    assert 'collection = "deletion_audit"' in ttl
    assert 'field      = "expires_at"' in ttl
    assert "ttl_config {}" in ttl
    assert "index_config {}" in ttl


def test_firestore_runtime_contract_is_wired_to_both_services() -> None:
    service = (TERRAFORM_ROOT / "service.tf").read_text()
    outputs = (TERRAFORM_ROOT / "outputs.tf").read_text()
    ingress = service.split('resource "google_cloud_run_v2_service" "ingress"', 1)[
        1
    ].split('resource "google_cloud_run_v2_service" "worker"', 1)[0]
    worker = service.split('resource "google_cloud_run_v2_service" "worker"', 1)[1]

    shared_values = {
        "FIRESTORE_DATABASE_ID": "google_firestore_database.qali.name",
        "FIRESTORE_JOBS_COLLECTION": '"jobs"',
        "FIRESTORE_JOB_LOCKS_COLLECTION": '"job-locks"',
        "FIRESTORE_JOB_LEASE_SECONDS": '"960"',
    }
    for name, value in shared_values.items():
        assert f'name  = "{name}"' in ingress
        assert f"value = {value}" in ingress
        assert f'name  = "{name}"' in worker
        assert f"value = {value}" in worker

    assert 'name  = "FIRESTORE_PROJECTS_COLLECTION"' in worker
    assert 'name  = "FIRESTORE_SOURCES_COLLECTION"' in worker
    assert 'value = "projects"' in worker
    assert 'value = "sources"' in worker
    assert 'name  = "FIRESTORE_PROJECTS_COLLECTION"' not in ingress
    assert 'name  = "FIRESTORE_SOURCES_COLLECTION"' not in ingress
    assert 'output "firestore_database_id"' in outputs


def test_firestore_deployment_guidance_requires_importing_an_existing_database() -> (
    None
):
    readme = " ".join(Path("README.md").read_text().split())

    assert "Check whether the `(default)` Firestore database already exists" in readme
    assert "terraform import google_firestore_database.qali" in readme
    assert "Do not attempt to recreate an existing database" in readme
