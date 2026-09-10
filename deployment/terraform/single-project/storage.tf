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

resource "google_storage_bucket" "artifacts" {
  project  = var.project_id
  name     = "${var.project_id}-${var.project_name}-artifacts"
  location = var.region

  storage_class = "STANDARD"

  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle {
    prevent_destroy = true
  }

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      days_since_noncurrent_time = 7
      send_age_if_zero            = false
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = 90
      with_state     = "LIVE"
      matches_prefix = ["projects/"]
      matches_suffix = [
        "/request.md",
        "/plan.json",
        "/result.json",
        "/report.md",
      ]
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = 1
      with_state     = "LIVE"
      matches_prefix = ["uploads/"]
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = 30
      with_state     = "LIVE"
      matches_prefix = ["projects/"]
      matches_suffix = [
        "/trace.zip",
        "/accessibility.md",
        "/console.json",
        "/network.json",
        "/screenshot.png",
      ]
    }
  }

  labels = {
    "created-by" = "adk"
    "component"  = "private-artifacts"
  }

  depends_on = [resource.google_project_service.services]
}
