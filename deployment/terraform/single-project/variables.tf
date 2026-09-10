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

variable "project_name" {
  type        = string
  description = "Project name used as a base for resource naming"
  default     = "qali"
}

variable "project_id" {
  type        = string
  description = "Google Cloud Project ID for resource deployment."
}

variable "region" {
  type        = string
  description = "Google Cloud region for resource deployment."
  default     = "europe-west1"
}

variable "container_image" {
  type        = string
  description = "Approved immutable container image URI shared by Qali services."

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "container_image must use an immutable sha256 digest."
  }
}

variable "slack_signing_secret_id" {
  type        = string
  description = "Pre-provisioned Secret Manager secret containing the Slack signing secret."
  default     = "qali-slack-signing-secret"

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+$", var.slack_signing_secret_id))
    error_message = "slack_signing_secret_id must be a same-project secret ID."
  }
}

variable "slack_bot_token_secret_id" {
  type        = string
  description = "Pre-provisioned Secret Manager secret containing the Slack bot token."
  default     = "qali-slack-bot-token"

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+$", var.slack_bot_token_secret_id))
    error_message = "slack_bot_token_secret_id must be a same-project secret ID."
  }
}

variable "gemini_api_key_secret_id" {
  type        = string
  description = "Pre-provisioned Secret Manager secret containing the Gemini Developer API key."
  default     = "qali-gemini-api-key"

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+$", var.gemini_api_key_secret_id))
    error_message = "gemini_api_key_secret_id must be a same-project secret ID."
  }
}

variable "target_credential_secret_ids" {
  type        = list(string)
  description = "Explicit same-project allowlist of pre-provisioned browser credential secret IDs."
  default     = []

  validation {
    condition = (
      length(var.target_credential_secret_ids) <= 20 &&
      length(distinct(var.target_credential_secret_ids)) == length(var.target_credential_secret_ids) &&
      alltrue([
        for secret_id in var.target_credential_secret_ids :
        can(regex("^[A-Za-z0-9_-]+$", secret_id))
      ])
    )
    error_message = "target_credential_secret_ids must contain at most 20 distinct same-project secret IDs."
  }
}

variable "ingress_sa_roles" {
  description = "Project roles required by the Slack ingress service account."
  type        = list(string)
  default = [
    "roles/logging.logWriter",
    "roles/datastore.user",
    "roles/serviceusage.serviceUsageConsumer",
  ]
}

variable "worker_sa_roles" {
  description = "Project roles required by the unified worker service account."
  type        = list(string)
  default = [
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
    "roles/datastore.user",
    "roles/serviceusage.serviceUsageConsumer",
  ]
}
