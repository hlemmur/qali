from pathlib import Path

TERRAFORM_ROOT = Path("deployment/terraform/single-project")


def test_monthly_budget_is_scoped_to_qali_with_owner_alerts() -> None:
    apis = (TERRAFORM_ROOT / "apis.tf").read_text()
    budget = (TERRAFORM_ROOT / "budget.tf").read_text()
    variables = (TERRAFORM_ROOT / "variables.tf").read_text()

    assert '"billingbudgets.googleapis.com"' in apis
    assert 'variable "billing_account_id"' in variables
    assert 'resource "google_billing_budget" "qali"' in budget
    assert 'projects        = ["projects/${data.google_project.qali.number}"]' in budget
    assert 'calendar_period = "MONTH"' in budget
    assert 'currency_code = "SEK"' in budget
    assert 'units         = "100"' in budget
    assert budget.count("threshold_rules {") == 4
    assert "threshold_percent = 0.5" in budget
    assert "threshold_percent = 0.9" in budget
    assert "threshold_percent = 1.0" in budget
    assert 'spend_basis       = "FORECASTED_SPEND"' in budget
    assert "enable_project_level_recipients = true" in budget
    assert "disable_default_iam_recipients  = false" in budget


def test_deployment_guide_requires_budget_preflight_without_claiming_a_cap() -> None:
    readme = " ".join(Path("README.md").read_text().split())
    readiness = " ".join(Path("docs/release-readiness.md").read_text().split())

    assert "100 SEK monthly budget is an alert boundary, not a spending cap" in readme
    assert "billing_account_id" in readme
    assert "Billing Account Administrator or Billing Account Costs Manager" in readme
    assert "50%, 90%, 100%, and forecasted 100%" in readme
    assert (
        "reviewed Terraform defines a project-scoped 100 SEK monthly alert" in readiness
    )
