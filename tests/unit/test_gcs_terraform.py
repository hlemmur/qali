from pathlib import Path

TERRAFORM_ROOT = Path("deployment/terraform/single-project")


def test_artifact_bucket_is_private_protected_and_recoverable() -> None:
    apis = (TERRAFORM_ROOT / "apis.tf").read_text()
    storage = (TERRAFORM_ROOT / "storage.tf").read_text()

    assert '"storage.googleapis.com"' in apis
    assert 'resource "google_storage_bucket" "artifacts"' in storage
    assert 'name     = "${var.project_id}-${var.project_name}-artifacts"' in storage
    assert "location = var.region" in storage
    assert 'storage_class = "STANDARD"' in storage
    assert "force_destroy               = false" in storage
    assert "uniform_bucket_level_access = true" in storage
    assert 'public_access_prevention    = "enforced"' in storage
    assert "prevent_destroy = true" in storage
    assert "deletion_policy" not in storage
    assert "versioning" in storage
    assert "enabled = true" in storage
    assert "soft_delete_policy" in storage
    assert "retention_duration_seconds = 604800" in storage
    assert "days_since_noncurrent_time = 7" in storage
    assert "send_age_if_zero            = false" in storage
    assert 'type = "Delete"' in storage


def test_artifact_bucket_access_is_worker_only_and_object_scoped() -> None:
    iam = (TERRAFORM_ROOT / "iam.tf").read_text()
    artifact_iam = iam.split(
        'resource "google_storage_bucket_iam_member" "worker_artifact_user"', 1
    )[1]

    assert "bucket = google_storage_bucket.artifacts.name" in artifact_iam
    assert 'role   = "roles/storage.objectUser"' in artifact_iam
    assert "google_service_account.worker_sa.email" in artifact_iam
    assert "google_service_account.ingress_sa.email" not in artifact_iam
    assert "roles/storage.admin" not in artifact_iam
    assert "allUsers" not in artifact_iam
    assert "allAuthenticatedUsers" not in artifact_iam


def test_artifact_bucket_runtime_contract_is_worker_only() -> None:
    service = (TERRAFORM_ROOT / "service.tf").read_text()
    outputs = (TERRAFORM_ROOT / "outputs.tf").read_text()
    ingress = service.split('resource "google_cloud_run_v2_service" "ingress"', 1)[
        1
    ].split('resource "google_cloud_run_v2_service" "worker"', 1)[0]
    worker = service.split('resource "google_cloud_run_v2_service" "worker"', 1)[1]

    assert 'name  = "GCS_ARTIFACTS_BUCKET"' in worker
    assert "value = google_storage_bucket.artifacts.name" in worker
    assert 'name  = "GCS_TIMEOUT_SECONDS"' in worker
    assert 'value = "60"' in worker
    assert "GCS_ARTIFACTS_BUCKET" not in ingress
    assert "GCS_TIMEOUT_SECONDS" not in ingress
    assert 'output "artifacts_bucket_name"' in outputs


def test_artifact_bucket_guidance_requires_importing_an_existing_bucket() -> None:
    readme = " ".join(Path("README.md").read_text().split())

    assert "Check whether the artifact bucket already exists" in readme
    assert "terraform import google_storage_bucket.artifacts" in readme
    assert "Do not attempt to recreate an existing bucket" in readme


def test_live_run_documents_expire_after_ninety_days() -> None:
    storage = (TERRAFORM_ROOT / "storage.tf").read_text()
    retention = storage[
        storage.index("age            = 90") - 180 : storage.index(
            "age            = 90"
        )
        + 480
    ]

    assert 'type = "Delete"' in retention
    assert 'with_state     = "LIVE"' in retention
    assert 'matches_prefix = ["projects/"]' in retention
    assert '"/request.md"' in retention
    assert '"/plan.json"' in retention
    assert '"/result.json"' in retention
    assert '"/report.md"' in retention


def test_live_browser_evidence_expires_after_thirty_days() -> None:
    storage = (TERRAFORM_ROOT / "storage.tf").read_text()
    retention = storage[
        storage.index("age            = 30") - 180 : storage.index(
            "age            = 30"
        )
        + 580
    ]

    assert 'type = "Delete"' in retention
    assert 'with_state     = "LIVE"' in retention
    assert 'matches_prefix = ["projects/"]' in retention
    assert '"/trace.zip"' in retention
    assert '"/accessibility.md"' in retention
    assert '"/console.json"' in retention
    assert '"/network.json"' in retention
    assert '"/screenshot.png"' in retention


def test_staged_uploads_expire_after_one_day() -> None:
    storage = (TERRAFORM_ROOT / "storage.tf").read_text()
    retention = storage[
        storage.index("age            = 1") - 180 : storage.index("age            = 1")
        + 260
    ]

    assert 'type = "Delete"' in retention
    assert 'with_state     = "LIVE"' in retention
    assert 'matches_prefix = ["uploads/"]' in retention


def test_retention_guide_preserves_project_knowledge_until_deletion() -> None:
    readme = " ".join(Path("README.md").read_text().split())

    assert "Run documents expire after 90 days" in readme
    assert "browser evidence expires after 30 days" in readme
    assert "`uploads/` staging prefix expires after 24 hours" in readme
    assert (
        "sources, compiled knowledge, feature context, findings, and projections"
        in readme
    )
    assert "remain until explicit project deletion" in readme
