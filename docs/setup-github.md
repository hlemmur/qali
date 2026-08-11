# GitHub setup

Qali uses **two** GitHub credentials with least privilege:

1. **Dispatch App** — trigger `execute.yml`, read workflow status (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`)
2. **Publication token** — create branches, commits, PRs, auto-merge (`QALI_PUBLISH_GITHUB_TOKEN`)

## 1. GitHub App (dispatch)

Create a GitHub App on the target repository or organization:

**Permissions (repository):**

| Permission | Access                             |
| ---------- | ---------------------------------- |
| Actions    | Read and write (workflow dispatch) |
| Contents   | Read                               |
| Metadata   | Read                               |

**Events:** `workflow_run`

**Webhook URL:** `https://<your-worker>.workers.dev/github/webhook`

**Webhook secret:** `GITHUB_WEBHOOK_SECRET`

Install the app on the Qali repository. Record:

- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM, base64 or multiline secret)
- `GITHUB_OWNER`, `GITHUB_REPO`
- `GITHUB_WORKFLOW_FILE=execute.yml`

## 2. Publication credential

The publication job needs write access isolated from the execute job:

**Option A — second GitHub App** (recommended)

- Contents: Read and write
- Pull requests: Read and write
- Generate an installation token stored as `QALI_PUBLISH_GITHUB_TOKEN`

**Option B — fine-grained PAT** with contents + pull_requests on the Qali repo only.

Publication **never** pushes to `main`. Flow:

```
git diff → publication-request.json → policy check
  → branch qali/<request-id>
  → commit governed files only
  → open PR → enable auto-merge (squash)
```

If `QALI_PUBLISH_GITHUB_TOKEN` is unset, generated changes remain as `.qali/generated.patch` in the workflow artifact.

## 3. Workflow: `execute.yml`

Triggered by:

- `workflow_dispatch` from Slack (carries full `command_json`)
- Daily schedule (demo smoke scaffold)

Job `validate-and-execute` runs with `permissions: contents: read`.

Job `publish-generated-changes` runs only after success and only when the publication token is configured.

## 4. Cursor CLI (optional, execution)

When `CURSOR_MODEL` is set in repository variables, agent workflow steps invoke the Cursor CLI (`agent -p`) inside the runner. Without it, Mock Mode and deterministic fakes cover local development.

## 5. Repository variables and secrets

| Name                        | Where          | Purpose                     |
| --------------------------- | -------------- | --------------------------- |
| `QALI_PUBLISH_GITHUB_TOKEN` | Secret         | Controlled publication      |
| `GITHUB_APP_ID` etc.        | Worker secrets | Dispatch from control plane |
| `CURSOR_MODEL`              | Variable       | Agent model selection       |

## Production guardrails

- Target projects may have **no preview URL** — tests run against the configured base URL (production today).
- Execute job cannot write to the repository; publication is a separate job with explicit policy checks.
- Unsafe mutations (assertion weakening, visual baseline updates, deletes, authority changes) are rejected by `@qali/publication`.

## Troubleshooting

| Symptom              | Check                                                                |
| -------------------- | -------------------------------------------------------------------- |
| Dispatch 404         | `GITHUB_WORKFLOW_FILE` must be `execute.yml`                         |
| Uncorrelated webhook | D1 correlation; request id in dispatch inputs                        |
| Publication rejected | Manifest mutation class; missing provenance or approved scenario ref |
| Auto-merge disabled  | Repository setting “Allow auto-merge”                                |
| PR not created       | Token scopes; branch name must start with `qali/`                    |

## Audit

All publication PRs include deterministic check names in the body. Workflow artifacts retain Playwright reports and evidence for **14 days** (`retention-days: 14` in `execute.yml`).
