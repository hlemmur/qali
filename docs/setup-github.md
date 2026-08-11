# GitHub setup

GitHub is Qali’s **execution host**. Slack talks to the Cloudflare Worker; the Worker starts a GitHub Actions workflow; when the run finishes, GitHub calls the Worker back; the Worker replies in Slack.

```
Slack → Cloudflare Worker → GitHub Actions (execute.yml) → webhook → Worker → Slack
```

You need **two** credentials eventually (least privilege). For a first Slack → Actions smoke test, only the **Dispatch App** is required.

| Credential               | Purpose                                                       | Do it now?       |
| ------------------------ | ------------------------------------------------------------- | ---------------- |
| **1. Dispatch App**      | Start `execute.yml` and receive `workflow_run` webhooks       | **Yes**          |
| **2. Publication token** | Open PRs with generated changes (`QALI_PUBLISH_GITHUB_TOKEN`) | Later (optional) |

Deploy the Worker first ([setup-cloudflare.md](setup-cloudflare.md)) so the webhook URL exists.

---

## What “done” looks like (minimum path)

After this guide:

1. `.env` has the Dispatch App fields filled.
2. Those values are synced to the Worker (`npm run control-plane:sync-secrets -- --only github`).
3. A Slack message to Qali starts **Actions → Execute Qali workflow**.
4. When the run finishes, Slack gets a follow-up (or you see the run in the Actions tab).

Skip publication and Cursor CLI until that works.

---

## 1. Confirm Actions on the Qali repo

1. Open your Qali repository on GitHub (example: `https://github.com/<owner>/qali`).
2. **Settings → Actions → General** — Actions must be enabled.
3. Confirm `.github/workflows/execute.yml` is on the default branch (`main`).
4. Optional sanity check: **Actions → Execute Qali workflow → Run workflow**.  
   If that workflow exists, GitHub can run jobs. (Manual runs need the `workflow_dispatch` inputs; a failed manual attempt is fine — you only care that the workflow appears.)

Set these in `.env` to match the repo:

```bash
GITHUB_OWNER=<github-username-or-org>   # e.g. hlemmur
GITHUB_REPO=qali
GITHUB_WORKFLOW_FILE=execute.yml
GITHUB_REF=main
```

---

## 2. Create the Dispatch GitHub App (click-by-click)

This app is the Worker’s remote control: it dispatches workflows and sends completion events back.

### 2.1 Start the app

1. Go to [github.com/settings/apps](https://github.com/settings/apps) → **New GitHub App**  
   (Or **Organization settings → Developer settings → GitHub Apps** if the app should be org-owned.)
2. Fill:

| Field                | Value                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GitHub App name**  | Something unique, e.g. `Qali Dispatch`                                                                                                                 |
| **Homepage URL**     | Your repo URL, e.g. `https://github.com/<owner>/qali`                                                                                                  |
| **Webhook → Active** | Checked                                                                                                                                                |
| **Webhook URL**      | `https://qali-slack-control.<your-subdomain>.workers.dev/github/webhook` — same base as `WORKER_BASE_URL` ([setup-cloudflare.md](setup-cloudflare.md)) |
| **Webhook secret**   | Invent a long random string. Put the **same** value in `.env` as `GITHUB_WEBHOOK_SECRET`.                                                              |

### 2.2 Repository permissions

Under **Repository permissions**:

| Permission   | Access                        |
| ------------ | ----------------------------- |
| **Actions**  | Read and write                |
| **Contents** | Read-only                     |
| **Metadata** | Read-only (usually forced on) |

Leave other permissions as No access.

### 2.3 Subscribe to events

Under **Subscribe to events**, enable:

- **Workflow run** (`workflow_run`)

### 2.4 Install target

- **Where can this GitHub App be installed?** → **Only on this account** (fine for a personal repo).

Click **Create GitHub App**.

### 2.5 Copy App ID and private key

On the new app’s settings page:

1. Copy **App ID** → `.env` as `GITHUB_APP_ID`.
2. Scroll to **Private keys** → **Generate a private key** (downloads a `.pem` file).
3. Paste the **full PEM text** into `.env` as `GITHUB_APP_PRIVATE_KEY`, including the `BEGIN` / `END` lines:

```bash
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

(Multiline in `.env` is fine; sync script reads it as one secret. GitHub often downloads `BEGIN RSA PRIVATE KEY`; the Worker accepts that or PKCS#8 `BEGIN PRIVATE KEY`.)

### 2.6 Install the app on the Qali repository

1. On the app page: **Install App**.
2. Choose your account → **Only select repositories** → select `qali` → **Install**.
3. After install, the browser URL looks like:

   `https://github.com/settings/installations/12345678`

   That number (`12345678`) is **`GITHUB_INSTALLATION_ID`**. Put it in `.env`.

---

## 3. Fill `.env` and sync to the Worker

Minimum Dispatch block (see `.env.example`):

```bash
GITHUB_OWNER=<owner>
GITHUB_REPO=qali
GITHUB_APP_ID=<app-id>
GITHUB_INSTALLATION_ID=<installation-id>
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<same-as-app-webhook-secret>
GITHUB_WORKFLOW_FILE=execute.yml
GITHUB_REF=main
```

Use PKCS#8 (`BEGIN PRIVATE KEY`) or PKCS#1 (`BEGIN RSA PRIVATE KEY`) — the Worker accepts both. Leave `QALI_PUBLISH_GITHUB_TOKEN` empty for now.

Push to Cloudflare:

```bash
npm run control-plane:sync-secrets -- --only github
npm run control-plane:deploy   # if the Worker was live before these secrets existed
```

Secrets live on the **Worker**, not as GitHub Actions secrets — except:

| Actions secret / variable         | Purpose                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `QALI_CALLBACK_SECRET`            | Same value as `GITHUB_WEBHOOK_SECRET` — Actions posts pass/fail counts to `/github/run-summary` |
| `QALI_WORKER_BASE_URL` (variable) | Worker base URL, e.g. `https://qali-slack-control.<subdomain>.workers.dev`                      |
| `QALI_PUBLISH_GITHUB_TOKEN`       | Optional publication job (§5)                                                                   |
| `CURSOR_MODEL` (variable)         | Optional agent model (§6)                                                                       |
| `CURSOR_API_KEY`                  | Cursor Agent CLI auth for Actions (§6)                                                          |

---

## 4. Smoke test

1. In Slack: invite `@Qali` or open a DM → send a simple request (e.g. run a suite / explore).
2. Open GitHub → **Actions** → you should see **Execute Qali workflow** start.
3. When it completes, the Worker should receive the webhook and post back in Slack.

| If this fails…                  | Check                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No Actions run                  | `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, private key, Actions permission, `GITHUB_OWNER` / `GITHUB_REPO`, workflow file name     |
| Run starts, Slack never updates | Webhook URL matches `WORKER_BASE_URL/github/webhook`, `GITHUB_WEBHOOK_SECRET` matches the App, Worker redeployed after secret sync |
| Dispatch 404                    | `GITHUB_WORKFLOW_FILE` must be exactly `execute.yml` (file under `.github/workflows/`)                                             |

---

## 5. Publication credential (optional — later)

The execute job is **read-only** (`permissions: contents: read`). A separate job, `publish-generated-changes`, opens PRs only when a write token is configured.

Publication **never** pushes to `main`:

```
git diff → publication-request.json → policy check
  → branch qali/<request-id>
  → commit governed files only
  → open PR → enable auto-merge (squash)
```

If `QALI_PUBLISH_GITHUB_TOKEN` is unset, generated changes stay as `.qali/generated.patch` in the workflow artifact (14-day retention). That is enough for early testing.

### Option A — second GitHub App (recommended)

1. Create another GitHub App with:
   - **Contents**: Read and write
   - **Pull requests**: Read and write
2. Install it on the Qali repo only.
3. Create an installation access token (or use your preferred short-lived token flow) and store it as the GitHub Actions secret **`QALI_PUBLISH_GITHUB_TOKEN`** on the Qali repo (**Settings → Secrets and variables → Actions**).

### Option B — fine-grained PAT

Create a fine-grained personal access token with **Contents** + **Pull requests** on the Qali repo only. Store it as the same repo secret `QALI_PUBLISH_GITHUB_TOKEN`.

Also enable **Settings → General → Allow auto-merge** if you want squash auto-merge after checks.

Unsafe mutations (assertion weakening, visual baseline updates, deletes, authority changes) are rejected by `@qali/publication`.

---

## 6. Cursor CLI (live agent mode)

When both are configured, Qali uses the real Cursor Agent CLI for explore / generate / triage / maintenance steps instead of the deterministic fallback:

| Name             | Where                | Purpose                                                                           |
| ---------------- | -------------------- | --------------------------------------------------------------------------------- |
| `CURSOR_MODEL`   | Actions **variable** | Model id, e.g. `sonnet-4` or `gpt-5`                                              |
| `CURSOR_API_KEY` | Actions **secret**   | User API key from [Cursor Dashboard → API Keys](https://cursor.com/dashboard/api) |

`execute.yml` installs the CLI on the runner when `CURSOR_MODEL` is set:

```bash
curl https://cursor.com/install -fsS | bash
```

Set them once:

```bash
gh variable set CURSOR_MODEL --repo <owner>/qali --body 'sonnet-4'
gh secret set CURSOR_API_KEY --repo <owner>/qali
# paste the key when prompted
```

Without either value (or if `agent` is missing), execution keeps using the **deterministic fallback** so smoke runs still succeed.

Local Mock Mode still works via `npm run demo:loop` with no Cursor install.

---

## 7. Where each value lives

| Name                                  | Where it goes                     | Purpose                          |
| ------------------------------------- | --------------------------------- | -------------------------------- |
| `GITHUB_APP_ID`                       | Worker secret (via `.env` + sync) | Dispatch App identity            |
| `GITHUB_APP_PRIVATE_KEY`              | Worker secret                     | Sign installation tokens         |
| `GITHUB_INSTALLATION_ID`              | Worker secret                     | Which install to act as          |
| `GITHUB_OWNER` / `GITHUB_REPO`        | Worker secret                     | Target repository                |
| `GITHUB_WEBHOOK_SECRET`               | Worker secret                     | Verify GitHub → Worker webhooks  |
| `GITHUB_WORKFLOW_FILE` / `GITHUB_REF` | Worker vars / `.env`              | Usually `execute.yml` / `main`   |
| `QALI_WORKER_BASE_URL`                | GitHub Actions repo **variable**  | Worker URL for run-summary POST  |
| `QALI_CALLBACK_SECRET`                | **GitHub Actions** repo secret    | Same as `GITHUB_WEBHOOK_SECRET`  |
| `QALI_PUBLISH_GITHUB_TOKEN`           | **GitHub Actions** repo secret    | Controlled publication job only  |
| `CURSOR_MODEL`                        | GitHub Actions repo **variable**  | Optional agent model             |
| `CURSOR_API_KEY`                      | **GitHub Actions** repo secret    | Cursor Agent CLI auth in Actions |

---

## Workflow reference: `execute.yml`

Triggered by:

- `workflow_dispatch` from the Worker (Slack path; carries full `command_json`)
- Daily schedule (demo smoke scaffold)

Jobs:

- `validate-and-execute` — read-only; runs the requested work
- `publish-generated-changes` — only after success, and only when `QALI_PUBLISH_GITHUB_TOKEN` is set

---

## Production guardrails

- Target projects may have **no preview URL** — tests run against the configured base URL (production today).
- Execute job cannot write to the repository; publication is a separate job with explicit policy checks.
- Publication PRs include deterministic check names in the body. Artifacts keep Playwright reports and evidence for **14 days** (`retention-days: 14`).

## Cost

- GitHub Actions minutes (private repos bill; public usually free within limits).
- No extra GitHub App fee for the Dispatch App itself.
- Worker webhook traffic is covered under Cloudflare Worker limits ([setup-cloudflare.md](setup-cloudflare.md)).

## Troubleshooting

| Symptom                   | Check                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| Dispatch 404              | `GITHUB_WORKFLOW_FILE` must be `execute.yml`                         |
| Uncorrelated webhook      | D1 correlation; `request_id` in dispatch inputs                      |
| Publication rejected      | Manifest mutation class; missing provenance or approved scenario ref |
| Auto-merge disabled       | Repo setting “Allow auto-merge”                                      |
| PR not created            | Token scopes; branch name must start with `qali/`                    |
| Webhook delivery failures | App → **Advanced** → Recent Deliveries; confirm URL and secret       |

## Related

- [setup-cloudflare.md](setup-cloudflare.md) — Worker URL and secret sync
- [setup-slack.md](setup-slack.md) — Slack app and allowlists
- [autonomy-and-security.md](autonomy-and-security.md) — roles and publication policy
