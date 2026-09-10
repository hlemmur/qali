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

data "google_project" "qali" {
  project_id = var.project_id
}

data "google_billing_account" "qali" {
  billing_account = var.billing_account_id
}

# This budget is an alert boundary, not an automatic spending cap. Keep the
# scale-to-zero and workload-level limits as the preventive cost controls.
resource "google_billing_budget" "qali" {
  billing_account = data.google_billing_account.qali.id
  display_name    = "${var.project_name} monthly alert boundary"

  budget_filter {
    projects        = ["projects/${data.google_project.qali.number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "SEK"
      units         = "100"
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    disable_default_iam_recipients  = false
    enable_project_level_recipients = true
  }

  depends_on = [resource.google_project_service.services]
}
