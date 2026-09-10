# qali


Agent generated with `agents-cli` version `1.4.2`

## Project Structure

```
qali/
├── app/         # Core agent code
│   ├── agent.py               # Main agent logic
│   ├── fast_api_app.py        # FastAPI Backend server
│   └── app_utils/             # App utilities and helpers
├── tests/                     # Unit, integration, and load tests
├── AGENTS.md                  # Coding-agent development guide
└── pyproject.toml             # Project dependencies
```

The repository guidance for coding agents is maintained in `AGENTS.md`.

## Requirements

Before you begin, ensure you have:
- **uv**: Python package manager (used for all dependency management in this project) - [Install](https://docs.astral.sh/uv/getting-started/installation/) ([add packages](https://docs.astral.sh/uv/concepts/dependencies/) with `uv add <package>`)
- **agents-cli**: Agents CLI - Install with `uv tool install google-agents-cli`
- **Google Cloud SDK**: For GCP services - [Install](https://cloud.google.com/sdk/docs/install)


## Quick Start

Install `agents-cli` and its skills if not already installed:

```bash
uvx google-agents-cli setup
```

Install required packages:

```bash
agents-cli install
```

Test the agent with a local web server:

```bash
agents-cli playground
```

The generated ADK surface now exposes Qali's bounded coordinator. It accepts a typed
request containing the project readiness state, natural-language Slack request, and
known finding IDs, then returns either one approved workflow route
(`onboard_project`, `test_feature`, or `explain_finding`) or one clarification
question. The coordinator has no tools and cannot access browsers, storage, secrets,
shells, Git, or deployment capabilities. Production Slack HTTP acknowledgement and
durable queue dispatch remain in the separate lightweight ingress service below.

Every default Gemini-backed agent uses the same free-tier runtime policy: the pinned
`gemini-3.7-flash` model, deterministic temperature, a 4,096-token output ceiling,
and at most three attempts for transient timeout/server errors. HTTP 429 quota errors
are deliberately excluded from SDK retries so exhausted free quota fails visibly and
cannot trigger an automatic paid fallback. Every isolated ADK invocation also has a
300-second wall-clock timeout and emits a stable, content-free timeout error. Tool-free
specialists may make one model request per invocation; the browser executor may make
at most its approved browser step budget plus one final completion request. A shared
process gate permits at most two active ADK invocations, preserving the strategy/risk
fan-out without allowing an unbounded free-tier request burst.

You can also use features from the [ADK](https://adk.dev/) CLI with `uv run adk`.

Run the standalone Slack ingress locally with explicit mock adapters:

```bash
QALI_MODE=mock uv run uvicorn 'app.slack_app:create_slack_ingress_app_from_env' \
  --factory --host 127.0.0.1 --port 8081
```

`GET http://127.0.0.1:8081/healthz` returns a visible `MOCK MODE` badge. Live
mode composes the Firestore job repository and Cloud Tasks dispatcher only when every
required Slack, GCP, queue, worker, OIDC, and service-account setting is present. It
uses Application Default Credentials and fails during startup when configuration is
missing or invalid. Local mock settings must never be used for a deployment.

The onboarding and feature paths share one fail-closed worker application entry point:

```bash
uv run uvicorn 'app.worker_runtime:create_worker_runtime_from_env' \
  --factory --host 127.0.0.1 --port 8082
```

It starts only with `QALI_MODE=live`, `GOOGLE_GENAI_USE_VERTEXAI=false`, a
Gemini Developer API key, and every Firestore, GCS, Slack, source-policy,
ClamAV, queue, and job-budget value documented in `.env.example`. Startup
validates the complete configuration before creating any production adapter.
The same private service exposes `/internal/jobs` for onboarding and
`/internal/feature-jobs` for feature tests and finding follow-ups, while rejecting
duplicate method/path registrations during composition.
The command itself does not provision cloud resources; live requests require
the separately approved GCP and Slack integrations.

Release promotion is governed by the fail-closed checklist and rollback procedure in
[`docs/release-readiness.md`](docs/release-readiness.md). Its decision remains NO-GO
until every approval-gated live evaluation, integration, deployment, observability,
and post-deployment gate has recorded evidence.

## Commands

| Command              | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `agents-cli install` | Install dependencies using uv                                                         |
| `agents-cli playground` | Launch local development environment                                                  |
| `agents-cli lint`    | Run code quality checks                                                               |
| `agents-cli eval run --dataset tests/eval/datasets/coordinator-routing.json` | Evaluate coordinator routing with the approved synthetic core cases; requires explicit approval and a free-tier credential |
| `uv run pytest tests/unit tests/integration` | Run unit and integration tests                                                        || [A2A Inspector](https://github.com/a2aproject/a2a-inspector) | Launch A2A Protocol Inspector                                                        |

## 🛠️ Project Management

| Command | What It Does |
|---------|--------------|
| `agents-cli scaffold enhance` | Add CI/CD pipelines and Terraform infrastructure |
| `agents-cli infra cicd` | One-command setup of entire CI/CD pipeline + infrastructure |
| `agents-cli scaffold upgrade` | Auto-upgrade to latest version while preserving customizations |

---

## Development

Edit your agent logic in `app/agent.py` and test with `agents-cli playground` - it auto-reloads on save.

## Deployment

The repository now contains a reviewed two-service Agents CLI Cloud Run baseline
under `deployment/terraform/`. The lightweight Slack ingress accepts internet ingress
at the Cloud Run networking layer so Slack can reach the signed-events application;
its invocation policy is still pending. The unified worker is internal-only,
scale-to-zero, single-concurrency, and configured for the Gemini Developer API rather
than Vertex AI. A single regional Cloud Tasks queue serializes dispatch, permits three
bounded attempts, and uses a dedicated OIDC identity that can invoke only the worker.
The ingress identity can enqueue only on that queue and can act as only the task
identity. Both services require an approved immutable image digest and use separate
runtime identities. Generated completion telemetry and content capture are disabled.

This baseline is not the complete Qali production topology and must not be applied.
Firestore, artifact storage, Secret Manager references, the Slack ingress invocation
policy, retention, and budget controls remain approval-gated work in the committed
implementation plan.
The checked-in Cloud Tasks configuration has not been initialized, planned, applied,
or live-verified. Follow `docs/release-readiness.md`; do not run `terraform apply`,
`agents-cli deploy`, or any resource-creating command without the owner's explicit
approval.

The same local Terraform configuration defines the Standard `(default)` Firestore
database in `europe-west1`, with pessimistic concurrency, App Engine integration and
paid point-in-time recovery disabled, and deletion protection enabled. Both runtime
identities receive `roles/datastore.user`; no database owner or import/export role is
granted. Check whether the `(default)` Firestore database already exists before any
approved infrastructure operation. If it does, import it into this Terraform state:

```bash
terraform import google_firestore_database.qali \
  'projects/PROJECT_ID/databases/(default)'
```

Do not attempt to recreate an existing database. Initialization, import, planning,
application, and live persistence verification all remain approval-gated.

The private artifact bucket uses the default name
`PROJECT_ID-qali-artifacts`, regional Standard storage, uniform bucket-level access,
enforced public-access prevention, versioning, and seven-day recovery windows for
noncurrent and soft-deleted objects. Only the worker identity receives
`roles/storage.objectUser`; the ingress has no artifact access. Check whether the
artifact bucket already exists before any approved infrastructure operation. If it
does, import it into this Terraform state:

```bash
terraform import google_storage_bucket.artifacts PROJECT_ID/BUCKET_NAME
```

Do not attempt to recreate an existing bucket. Initialization, import, planning,
application, and live artifact verification all remain approval-gated.

Run documents expire after 90 days, browser evidence expires after 30 days, and the
reserved `uploads/` staging prefix expires after 24 hours. Lifecycle-deleted objects
remain recoverable under the bucket's seven-day soft-delete policy. Current sources,
compiled knowledge, feature context, findings, and projections use other controlled
paths and remain until explicit project deletion. The application does not currently
persist staged uploads; any future staging writer must use the reserved prefix.

### Secret Manager preflight

Before an approved plan or deployment, provision the three default secret containers
(`qali-slack-signing-secret`, `qali-slack-bot-token`, and `qali-gemini-api-key`) and at
least one active version for each outside Terraform. Override the corresponding secret
ID variables when the approved names differ. The ingress can access only the Slack
signing secret; the worker can access only the Slack bot token and Gemini API key.

Browser target credentials remain opt-in. Add only their same-project secret IDs to
`target_credential_secret_ids`; this grants the worker secret-level accessor permission
without exposing them to ingress. The default allowlist is empty, and core Slack and
Gemini runtime secret IDs are rejected from it. Never place secret values in Terraform
variables, configuration, state, plans, documentation, Slack, or browser-agent context.
Terraform initialization, planning, application, and live secret verification remain
approval-gated.

## Observability

The reviewed baseline enables Cloud Trace and Cloud Logging APIs with model-message
content capture disabled. BigQuery completion telemetry is not provisioned.

## A2A Inspector

This agent supports the [A2A Protocol](https://a2a-protocol.org/). Use the [A2A Inspector](https://github.com/a2aproject/a2a-inspector) to test interoperability.
See the [A2A Inspector docs](https://github.com/a2aproject/a2a-inspector) for details.
