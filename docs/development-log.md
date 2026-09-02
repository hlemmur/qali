# Development log

## 2026-09-01 — Phase 1: official ADK recipe study

Isolated change: completed the mandatory pre-scaffold study and recorded Qali-specific reuse and deviation decisions in [reference-recipe-study.md](reference-recipe-study.md).

Reason: the approved implementation plan requires code-level study of matching official recipes before Agents CLI scaffolding or application code.

Skills and guidance:

- `google-agents-cli-workflow` 1.4.2
- `google-agents-cli-adk-code` 1.4.2
- `tdd`
- `google-agents-cli-adk-code/references/samples.md`

Official source:

- Repository: `google/adk-samples`
- Revision: `cf7cadbc537cab9a6105a9b9adf5a2af2da43061`
- Recipes: `long-horizon-harness`, `ambient-expense-agent`, `safety-plugins`, and `cross-session-memory`

Commands and evidence:

- Cloned the official repository into a temporary sparse checkout at the pinned revision.
- Read every selected recipe's `AGENTS.md` and the exact implementation files listed in the study record.
- Compared each pattern with the approved [.agents-cli-spec.md](../.agents-cli-spec.md) and [QALI_V2_IMPLEMENTATION_PLAN.md](../QALI_V2_IMPLEMENTATION_PLAN.md).
- Produced the reuse/adapt/reject matrix and first tracer-bullet consequences in [reference-recipe-study.md](reference-recipe-study.md).

Deviations:

- Replaced Pub/Sub-specific ambient ingress with signed Slack ingress plus Cloud Tasks.
- Replaced paid LLM-judge and Model Armor safety dependencies with deterministic mandatory controls for the private free-tier phase.
- Replaced Agent Engine Sessions and Memory Bank with Firestore and GCS durability.
- Narrowed the long-horizon environment and delegation patterns to a typed specialist workflow and deny-by-default Playwright MCP facade.
- Strengthened secret resolution to fail closed and required restart/cross-thread durability tests absent from the reference recipes.

Phase result: passed. No application scaffold, cloud resource, deployment, or external integration was changed during this phase. `agents-cli` and `uv` remain prerequisites for Phase 2.

## 2026-09-01 — Phase 2: prototype scaffold

Isolated change: installed the required local tooling, generated the Agents CLI ADK prototype in the existing Qali repository, and reconciled generated configuration with the approved private free-first architecture.

Reason: preserve the supported ADK, FastAPI, A2A, Docker, dependency, test, and eval conventions before implementing Qali behavior.

Skills and tools:

- `google-agents-cli-scaffold` 1.4.2
- `google-agents-cli-workflow` 1.4.2
- `tdd`
- `uv` 0.12.8
- `google-agents-cli` 1.4.2
- generated `google-adk>=2.6.0,<3.0.0`

Commands and evidence:

- Ran `agents-cli info` before scaffolding; it reported no agent project.
- Ran `agents-cli scaffold enhance . --prototype --agent-directory app --agent-guidance-filename AGENTS.md`.
- Ran `agents-cli install` and installed the declared lint extra.
- Verified `agents-cli info` recognizes project `qali`, agent directory `app`, A2A enabled, and deployment target `none`.
- Verified `4` unit tests pass.
- Verified `agents-cli lint` passes Ruff, Ruff format, codespell, and ty.
- Verified all `4` generated integration tests import and collect without executing their live Gemini calls.
- Verified the generated `gemini-3.7-flash` model against Google's current Gemini Developer API pricing page, which lists free-tier input and output.

TDD evidence:

- Red: the scaffold configuration tests exposed `base_template: local_qali`, `region: us-east1`, and Vertex mode in `.env.example`.
- Green: corrected the manifest to base `adk` and region `europe-west1`, and made the local example use the Gemini Developer API with project `qali-507317`.
- Red: the full lint gate scanned the separate `.agents` catalog and attempted to reformat reference snippets.
- Green: configured Ruff, ty, and codespell to exclude `.agents`; the full gate then passed without mutating the catalog.

Deviations and limitations:

- Agents CLI first failed inside the filesystem sandbox because Cookiecutter and backup metadata live under the user directory. The same approved command succeeded with access to those paths and created a local backup.
- Agents CLI 1.4.2 recorded the current repository as `local_qali` instead of its actual inherited `adk` base. That broke a later scaffold dry run, so the manifest metadata was corrected and protected by a unit test.
- The generated integration tests call the configured model. They were collected but not executed; the first feature slice must introduce explicit mock-mode integration coverage before any live-model test runs.
- Google's current free-tier terms say submitted content may be used to improve its products. The spec and plan now restrict free-tier calls to public, synthetic, or explicitly non-sensitive test data.
- GCP authentication, cloud resources, Slack secrets, Gemini API key provisioning, deployment, and live model usage remain untouched.

Phase result: passed for scaffolding and local deterministic validation. Phase 3 may begin after reloading the ADK-code and TDD guidance and inspecting the installed ADK signatures required by the first tracer bullet.

## 2026-09-02 — Phase 3: Cloud Tasks worker intake

Isolated change: added a typed internal worker intake boundary for the onboarding jobs emitted by the Cloud Tasks dispatcher.

Reason: the Slack ingress must acknowledge quickly and hand work to a separate worker service without weakening the typed job contract or trusting request headers as caller identity.

Skills and guidance:

- `google-agents-cli-workflow` 1.4.2
- `google-agents-cli-adk-code` 1.4.2
- `tdd`
- `google-agents-cli-adk-code/references/samples.md`

Official source:

- Repository: `google/adk-samples`
- Revision: `05b34ce388fa4c988434874a3d8ffcc0495f8527`
- Recipe: `ambient-expense-agent`
- Files studied: `AGENTS.md`, `expense_agent/fast_api_app.py`, and `tests/test_integration.py`

Reuse and deviations:

- Reused the recipe's typed event boundary and in-process ASGI integration-test pattern.
- Kept Qali's existing Cloud Tasks transport rather than adopting the recipe's Pub/Sub trigger.
- Kept durable job state outside ADK sessions rather than adopting the recipe's in-memory session behavior.
- Delegated caller authentication to private Cloud Run IAM with an OIDC task service account. The application checks Cloud Tasks queue and deterministic task-name provenance, but does not misrepresent informational headers as proof of identity.
- No Terraform, cloud resource, deployment, live credential, or model call was introduced.

TDD evidence:

- Red: the producer-to-worker contract test failed because no worker intake module existed.
- Green: the exact serialized dispatcher payload reached the worker handler as the same typed onboarding job.
- Red: a request naming an unconfigured queue was accepted.
- Green: the worker rejects queue mismatches before invoking the handler.
- Red: a task name could be paired with a different job payload.
- Green: dispatcher and worker now share the deterministic task-ID function, and mismatches are rejected before processing.

Commands and evidence:

- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `38 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for the isolated worker intake boundary. Production route composition and durable job claiming remain separate follow-up slices.

## 2026-09-02 — Phase 3: durable job claiming

Isolated change: added one-time job claiming to the Firestore production repository and the in-memory mock repository.

Reason: Cloud Tasks can redeliver work, so the worker needs an atomic transition from `pending` to `running` before starting onboarding. A retry or concurrent delivery must not start the same job twice.

Skills and API guidance:

- `tdd`
- Installed `google-cloud-firestore` 2.29 async client, document, batch, and transaction source for exact transaction signatures and retry semantics.

TDD evidence:

- Red: `FirestoreJobRepository` had no transaction seam or claim operation.
- Green: a pending document is read and changed to `running` inside one retryable async Firestore transaction, returning the typed job.
- Guard: a second claim sees the non-pending status and returns `None` without another update.
- Red: `InMemoryJobRepository` had no claim operation for local mock execution.
- Green: the mock repository now returns a stored job once under its existing async lock and rejects repeated or missing claims.

Safety and scope:

- The Firestore transaction runner wraps the installed official async transactional API rather than implementing retry behavior locally.
- No cloud call, resource, deployment, secret, live model, or live integration was used.
- Worker-handler composition, completion/failure transitions, time budgets, and project-level serialization remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `40 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for atomic one-time job claiming in production and mock repositories.

## 2026-09-02 — Phase 3: job completion and retry release

Isolated change: added guarded `running` to `completed` and `running` to `pending` retry transitions to the Firestore and in-memory job repositories.

Reason: a worker must finish a claimed job durably on success and must release transient failures before returning an error to Cloud Tasks. Without release, a redelivery would find the job stranded in `running` and silently skip it.

Skill and API guidance:

- `tdd`
- Installed `google-cloud-firestore` 2.29 async transaction behavior inspected in the preceding claim slice.

TDD evidence:

- Red: a claimed Firestore job had no completion operation.
- Green: completion atomically accepts only `running`, records the server completion timestamp, and rejects duplicate completion.
- Red: a failed running job had no safe path back to the retryable state.
- Green: release atomically returns `running` to `pending`, clears the stale start timestamp, records a server release timestamp and bounded retry reason, and permits a later claim.
- Red: the mock repository did not mirror completion or release behavior.
- Green: mock completion and retry release now run under the same async lock and enforce the same state order.

Safety and scope:

- Retry causes use `JobRetryReason`, a bounded `StrEnum`; arbitrary exception or secret-bearing text is not accepted as lifecycle state.
- Invalid or duplicate state transitions return `False` without writes.
- No cloud call, resource, deployment, secret, live model, or live integration was used.
- Worker processor composition, terminal failure policy, budgets, and project-level serialization remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `43 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for guarded completion and retry release in production and mock repositories.
