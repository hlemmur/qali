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

resource "google_firestore_database" "qali" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region

  type             = "FIRESTORE_NATIVE"
  database_edition = "STANDARD"

  concurrency_mode                  = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"

  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "PREVENT"

  depends_on = [resource.google_project_service.services]
}

resource "google_firestore_field" "deletion_audit_expiry" {
  project    = var.project_id
  database   = google_firestore_database.qali.name
  collection = "deletion_audit"
  field      = "expires_at"

  ttl_config {}
  index_config {}
}
