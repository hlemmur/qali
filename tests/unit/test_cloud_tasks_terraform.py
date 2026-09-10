from pathlib import Path

TERRAFORM_ROOT = Path("deployment/terraform/single-project")


def test_cloud_tasks_queue_is_rate_limited_and_has_bounded_retries() -> None:
    apis = (TERRAFORM_ROOT / "apis.tf").read_text()
    tasks = (TERRAFORM_ROOT / "tasks.tf").read_text()

    assert '"cloudtasks.googleapis.com"' in apis
    assert 'resource "google_cloud_tasks_queue" "jobs"' in tasks
    assert 'name     = "${var.project_name}-jobs"' in tasks
    assert "location = var.region" in tasks
    assert 'desired_state   = "RUNNING"' in tasks
    assert 'deletion_policy = "PREVENT"' in tasks
    assert "max_concurrent_dispatches = 1" in tasks
    assert "max_dispatches_per_second = 1" in tasks
    assert "max_attempts  = 3" in tasks
    assert 'min_backoff   = "5s"' in tasks
    assert 'max_backoff   = "60s"' in tasks
    assert "max_doublings = 3" in tasks
    assert "max_attempts = -1" not in tasks


def test_cloud_tasks_uses_a_dedicated_oidc_identity_and_least_privilege_iam() -> None:
    iam = (TERRAFORM_ROOT / "iam.tf").read_text()
    worker_invoker = iam.split(
        'resource "google_cloud_run_v2_service_iam_member" "tasks_worker_invoker"',
        1,
    )[1].split("}", 1)[0]

    assert 'resource "google_service_account" "tasks_sa"' in iam
    assert 'resource "google_cloud_tasks_queue_iam_member" "ingress_enqueuer"' in iam
    assert 'role     = "roles/cloudtasks.enqueuer"' in iam
    assert "google_service_account.ingress_sa.email" in iam
    assert 'resource "google_service_account_iam_member" "ingress_tasks_act_as"' in iam
    assert 'role               = "roles/iam.serviceAccountUser"' in iam
    assert (
        'resource "google_cloud_run_v2_service_iam_member" "tasks_worker_invoker"'
        in iam
    )
    assert 'role     = "roles/run.invoker"' in worker_invoker
    assert "google_service_account.tasks_sa.email" in worker_invoker
    assert "google_cloud_run_v2_service.worker.name" in worker_invoker
    assert "allUsers" not in worker_invoker
    assert "allAuthenticatedUsers" not in worker_invoker


def test_cloud_tasks_runtime_contract_wires_ingress_to_unified_worker() -> None:
    service = (TERRAFORM_ROOT / "service.tf").read_text()
    outputs = (TERRAFORM_ROOT / "outputs.tf").read_text()
    ingress = service.split('resource "google_cloud_run_v2_service" "ingress"', 1)[
        1
    ].split('resource "google_cloud_run_v2_service" "worker"', 1)[0]
    worker = service.split('resource "google_cloud_run_v2_service" "worker"', 1)[1]

    for name in (
        "CLOUD_TASKS_LOCATION",
        "CLOUD_TASKS_QUEUE_ID",
        "QALI_WORKER_URL",
        "QALI_WORKER_OIDC_AUDIENCE",
        "QALI_FEATURE_WORKER_URL",
        "QALI_FEATURE_WORKER_OIDC_AUDIENCE",
        "QALI_TASKS_SERVICE_ACCOUNT_EMAIL",
    ):
        assert f'name  = "{name}"' in ingress

    assert "${google_cloud_run_v2_service.worker.uri}/internal/jobs" in ingress
    assert "${google_cloud_run_v2_service.worker.uri}/internal/feature-jobs" in ingress
    assert ingress.count("google_cloud_run_v2_service.worker.uri") == 4
    assert "google_service_account.tasks_sa.email" in ingress
    assert 'name  = "CLOUD_TASKS_QUEUE_ID"' in worker
    assert "google_cloud_tasks_queue.jobs.name" in worker
    assert 'name  = "QALI_JOB_MAX_DELIVERY_ATTEMPTS"' in worker
    assert 'value = "3"' in worker
    assert 'output "tasks_queue_name"' in outputs
    assert 'output "tasks_service_account_email"' in outputs
