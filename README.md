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
cannot trigger an automatic paid fallback.

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

The separate onboarding worker has a fail-closed live composition entry point:

```bash
uv run uvicorn 'app.onboarding_runtime:create_onboarding_runtime_from_env' \
  --factory --host 127.0.0.1 --port 8082
```

It starts only with `QALI_MODE=live`, `GOOGLE_GENAI_USE_VERTEXAI=false`, a
Gemini Developer API key, and every Firestore, GCS, Slack, source-policy,
ClamAV, queue, and job-budget value documented in `.env.example`. Startup
validates the complete configuration before creating any production adapter.
The command itself does not provision cloud resources; live requests require
the separately approved GCP and Slack integrations.

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

```bash
gcloud config set project <your-project-id>
agents-cli deploy
```

To add CI/CD and Terraform, run `agents-cli scaffold enhance`.
To set up your production infrastructure, run `agents-cli infra cicd`.

## Observability

Built-in telemetry exports to Cloud Trace, BigQuery, and Cloud Logging.

## A2A Inspector

This agent supports the [A2A Protocol](https://a2a-protocol.org/). Use the [A2A Inspector](https://github.com/a2aproject/a2a-inspector) to test interoperability.
See the [A2A Inspector docs](https://github.com/a2aproject/a2a-inspector) for details.
