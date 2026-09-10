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

# Slack ingress service account
resource "google_service_account" "ingress_sa" {
  account_id   = "${var.project_name}-ingress"
  display_name = "${var.project_name} Slack Ingress Service Account"
  project      = var.project_id
  depends_on   = [resource.google_project_service.services]
}

# Unified worker service account
resource "google_service_account" "worker_sa" {
  account_id   = "${var.project_name}-worker"
  display_name = "${var.project_name} Worker Service Account"
  project      = var.project_id
  depends_on   = [resource.google_project_service.services]
}

# Identity used by Cloud Tasks to mint OIDC tokens for worker requests.
resource "google_service_account" "tasks_sa" {
  account_id   = "${var.project_name}-tasks"
  display_name = "${var.project_name} Cloud Tasks Service Account"
  project      = var.project_id
  depends_on   = [resource.google_project_service.services]
}

resource "google_project_iam_member" "ingress_sa_roles" {
  for_each = toset(var.ingress_sa_roles)

  project    = var.project_id
  role       = each.value
  member     = "serviceAccount:${google_service_account.ingress_sa.email}"
  depends_on = [resource.google_project_service.services]
}

resource "google_project_iam_member" "worker_sa_roles" {
  for_each = toset(var.worker_sa_roles)

  project    = var.project_id
  role       = each.value
  member     = "serviceAccount:${google_service_account.worker_sa.email}"
  depends_on = [resource.google_project_service.services]
}

# Restrict task creation to the Qali queue instead of granting the ingress
# identity project-wide Cloud Tasks permissions.
resource "google_cloud_tasks_queue_iam_member" "ingress_enqueuer" {
  project  = google_cloud_tasks_queue.jobs.project
  location = google_cloud_tasks_queue.jobs.location
  name     = google_cloud_tasks_queue.jobs.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.ingress_sa.email}"
}

# Creating an OIDC-authenticated task requires the caller to act as the
# identity named in that task's oidc_token block.
resource "google_service_account_iam_member" "ingress_tasks_act_as" {
  service_account_id = google_service_account.tasks_sa.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.ingress_sa.email}"
}

# The task identity can invoke only the private unified worker service.
resource "google_cloud_run_v2_service_iam_member" "tasks_worker_invoker" {
  project  = google_cloud_run_v2_service.worker.project
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks_sa.email}"
}
