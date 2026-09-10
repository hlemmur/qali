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

# Secret values and versions are provisioned out of band and never enter
# Terraform configuration, state, plans, or logs.
data "google_secret_manager_secret" "slack_signing" {
  project   = var.project_id
  secret_id = var.slack_signing_secret_id
}

data "google_secret_manager_secret" "slack_bot_token" {
  project   = var.project_id
  secret_id = var.slack_bot_token_secret_id
}

data "google_secret_manager_secret" "gemini_api_key" {
  project   = var.project_id
  secret_id = var.gemini_api_key_secret_id
}

resource "google_secret_manager_secret_iam_member" "ingress_signing_access" {
  project   = var.project_id
  secret_id = data.google_secret_manager_secret.slack_signing.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingress_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_slack_access" {
  project   = var.project_id
  secret_id = data.google_secret_manager_secret.slack_bot_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_gemini_access" {
  project   = var.project_id
  secret_id = data.google_secret_manager_secret.gemini_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_target_access" {
  for_each  = toset(var.target_credential_secret_ids)
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker_sa.email}"
}
