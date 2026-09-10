# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

resource "google_cloud_run_v2_service" "ingress" {
  name                = "${var.project_name}-ingress"
  location            = var.region
  project             = var.project_id
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels = {
    "created-by" = "adk"
    "component"  = "slack-ingress"
  }

  template {
    containers {
      image   = var.container_image
      command = ["uv", "run", "uvicorn"]
      args = [
        "app.slack_app:create_slack_ingress_app_from_env",
        "--factory",
        "--host",
        "0.0.0.0",
        "--port",
        "8080",
      ]

      ports {
        container_port = 8080
      }

      env {
        name  = "QALI_MODE"
        value = "live"
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = google_firestore_database.qali.name
      }

      env {
        name  = "FIRESTORE_JOBS_COLLECTION"
        value = "jobs"
      }

      env {
        name  = "FIRESTORE_JOB_LOCKS_COLLECTION"
        value = "job-locks"
      }

      env {
        name  = "FIRESTORE_JOB_LEASE_SECONDS"
        value = "960"
      }

      env {
        name  = "CLOUD_TASKS_LOCATION"
        value = var.region
      }

      env {
        name  = "CLOUD_TASKS_QUEUE_ID"
        value = google_cloud_tasks_queue.jobs.name
      }

      env {
        name  = "QALI_WORKER_URL"
        value = "${google_cloud_run_v2_service.worker.uri}/internal/jobs"
      }

      env {
        name  = "QALI_WORKER_OIDC_AUDIENCE"
        value = google_cloud_run_v2_service.worker.uri
      }

      env {
        name  = "QALI_FEATURE_WORKER_URL"
        value = "${google_cloud_run_v2_service.worker.uri}/internal/feature-jobs"
      }

      env {
        name  = "QALI_FEATURE_WORKER_OIDC_AUDIENCE"
        value = google_cloud_run_v2_service.worker.uri
      }

      env {
        name  = "QALI_TASKS_SERVICE_ACCOUNT_EMAIL"
        value = google_service_account.tasks_sa.email
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    service_account                  = google_service_account.ingress_sa.email
    max_instance_request_concurrency = 8

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    session_affinity = false
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [resource.google_project_service.services]
}

resource "google_cloud_run_v2_service" "worker" {
  name                = "${var.project_name}-worker"
  location            = var.region
  project             = var.project_id
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  labels = {
    "created-by" = "adk"
    "component"  = "worker"
  }

  template {
    timeout = "900s"

    containers {
      image   = var.container_image
      command = ["uv", "run", "uvicorn"]
      args = [
        "app.worker_runtime:create_worker_runtime_from_env",
        "--factory",
        "--host",
        "0.0.0.0",
        "--port",
        "8080",
      ]

      ports {
        container_port = 8080
      }

      env {
        name  = "QALI_MODE"
        value = "live"
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = google_firestore_database.qali.name
      }

      env {
        name  = "FIRESTORE_JOBS_COLLECTION"
        value = "jobs"
      }

      env {
        name  = "FIRESTORE_JOB_LOCKS_COLLECTION"
        value = "job-locks"
      }

      env {
        name  = "FIRESTORE_JOB_LEASE_SECONDS"
        value = "960"
      }

      env {
        name  = "FIRESTORE_PROJECTS_COLLECTION"
        value = "projects"
      }

      env {
        name  = "FIRESTORE_SOURCES_COLLECTION"
        value = "sources"
      }

      env {
        name  = "CLOUD_TASKS_QUEUE_ID"
        value = google_cloud_tasks_queue.jobs.name
      }

      env {
        name  = "QALI_JOB_MAX_DELIVERY_ATTEMPTS"
        value = "3"
      }

      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = "global"
      }

      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "false"
      }

      env {
        name  = "OTEL_SERVICE_NAME"
        value = "qali-worker"
      }

      env {
        name  = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"
        value = "NO_CONTENT"
      }

      env {
        name  = "ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"
        value = "false"
      }

      env {
        name  = "OTEL_SEMCONV_STABILITY_OPT_IN"
        value = "gen_ai_latest_experimental"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "4Gi"
        }
      }
    }

    service_account                  = google_service_account.worker_sa.email
    max_instance_request_concurrency = 1

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    session_affinity = false
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [resource.google_project_service.services]
}
