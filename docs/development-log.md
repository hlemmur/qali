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

## 2026-09-02 — Phase 3: deterministic worker lifecycle handler

Isolated change: composed job claiming, injected processing, completion, and retry release behind the worker ingress `JobHandler` contract.

Reason: the Cloud Tasks endpoint needs one deterministic owner for lifecycle ordering before it can invoke the onboarding coordinator. Redelivery must not repeat completed work, and a processor exception must release the claim before Cloud Tasks retries.

Skill and method:

- `tdd`
- Public behavior verified through the in-process FastAPI worker surface with in-memory production-interface parity.

TDD evidence:

- Red: no lifecycle-aware worker handler existed.
- Green: the worker claims the durable canonical job, invokes the injected processor, completes it, and acknowledges a redelivery without a second processor call.
- Red: a processor exception left the job claimed, so the next Cloud Tasks delivery was acknowledged without retrying the processor.
- Green: processor exceptions now release with `JobRetryReason.PROCESSOR_ERROR` before being re-raised; the HTTP request returns 500 and the next delivery processes successfully.

Safety and scope:

- The handler processes the repository's claimed job rather than trusting the request body after identity lookup.
- Processor exceptions are not persisted; only the bounded retry reason code reaches job state.
- The processor remains an injected protocol. No model, coordinator, cloud call, resource, deployment, secret, or live integration was added.
- Timeout/cancellation policy, terminal failure thresholds, leases, and coordinator composition remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `45 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic claim-process-complete and release-on-error worker handling.

## 2026-09-02 — Phase 3: worker deadline and cancellation release

Isolated change: bounded every worker processor invocation with a configurable maximum 15-minute deadline and added cleanup for timeout and external cancellation.

Reason: the implementation plan requires a 15-minute job budget and graceful cancellation/failure states. A timed-out or cancelled request must not leave its durable job permanently claimed as `running`.

Skill and method:

- `tdd`
- Async deadline behavior implemented with Python's structured `asyncio.timeout` context.

TDD evidence:

- Red: a blocking processor could run indefinitely and retain its claim.
- Green: `JobExecutionSettings` defaults to 900 seconds, rejects non-positive or greater-than-900 values, and timeout releases with `JobRetryReason.TIMEOUT` before propagating `TimeoutError`.
- Red: cancelling an active handler propagated `CancelledError` without lifecycle cleanup.
- Green: cancellation shields a release with `JobRetryReason.CANCELLED` before re-raising, allowing later retry.

Safety and scope:

- Timeout configuration is frozen and rejects unknown fields.
- Timeout and cancellation reasons remain bounded codes; no exception text is persisted.
- No cloud call, resource, deployment, secret, model, or live integration was used.
- Terminal retry thresholds, stale-lease recovery, project-level serialization, and coordinator composition remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `49 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded worker execution with timeout and cancellation release.

## 2026-09-02 — Phase 3: terminal job failure

Isolated change: added a guarded `running` to `failed` transition to the Firestore and in-memory job repositories.

Reason: retry exhaustion needs an explicit, durable terminal state before Cloud Tasks delivery metadata and retry-threshold policy are connected. Without it, exhausted jobs could remain retryable or stranded as `running`.

Skill and method:

- `tdd`
- Production-interface parity verified in both the Firestore repository and the local mock repository.

TDD evidence:

- Red: a running Firestore job had no terminal failure operation or bounded failure reason.
- Green: failure atomically accepts only `running`, records a server failure timestamp and `JobFailureReason.RETRY_EXHAUSTED`, and rejects a duplicate transition.
- Red: the mock repository could not represent terminal failure and allowed later lifecycle operations.
- Green: mock failure now runs under the repository lock and blocks subsequent claim, complete, release, and duplicate failure operations.

Safety and scope:

- Failure causes use a bounded `StrEnum`; arbitrary exception or secret-bearing text is not persisted.
- Invalid or duplicate state transitions return `False` without writes.
- No cloud call, resource, deployment, secret, model, or live integration was used.
- Cloud Tasks delivery metadata, retry thresholds, and worker composition remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `51 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for guarded terminal failure in production and mock repositories.

## 2026-09-02 — Phase 3: worker retry exhaustion

Isolated change: added fail-closed Cloud Tasks execution metadata intake and a bounded delivery-attempt policy that reserves the final delivery for durable terminal failure.

Reason: Cloud Tasks can delete an exhausted task after its retry policy ends. Qali must persist `failed` before that happens, without running the processor again on the reserved terminal delivery.

Skill and official guidance:

- `tdd`
- Google Cloud Tasks HTTP-target request-header documentation: `X-CloudTasks-TaskExecutionCount` counts previous handler responses and excludes dispatch failures that never received a handler response; the first delivery carries zero.
- Google Cloud Tasks `RetryConfig` documentation: `max_attempts` includes the first delivery.

TDD evidence:

- Red: `JobExecutionSettings` rejected the delivery-attempt policy and the final delivery still reached the processor.
- Green: a delivery whose execution count reaches `max_delivery_attempts - 1` claims the job, persists `JobFailureReason.RETRY_EXHAUSTED`, acknowledges the task, and never invokes the processor.
- Red: omitting the documented execution-count header silently defaulted the delivery to its first attempt.
- Green: the worker HTTP boundary now requires a non-negative execution count and rejects a missing value with `422` before invoking the handler.

Safety and scope:

- Delivery headers remain provenance metadata behind the private Cloud Run IAM boundary; they are not caller authentication.
- The default policy allows two processing deliveries and reserves the third for terminalization. The eventual Cloud Tasks queue `max_attempts` must be configured to the same value.
- Terminal failure stores only the bounded reason code; no retry-reason header, exception text, or secret-bearing value is persisted.
- No cloud call, resource, deployment, secret, model, or live integration was used.
- Queue infrastructure configuration and coordinator composition remain separate slices requiring their own validation and approval boundaries.

Commands and evidence:

- `uv run pytest tests/integration/test_cloud_tasks_worker.py -q` — `11 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `53 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for fail-closed execution metadata and durable retry exhaustion.

## 2026-09-02 — Phase 3: project-level job serialization

Isolated change: serialized onboarding jobs by the private MVP's one-project-per-Slack-channel mapping in both the Firestore production repository and the in-memory mock repository.

Reason: Cloud Tasks may dispatch distinct jobs concurrently. Qali must allow only one running job for a project so onboarding and later project-scoped workflows cannot race each other or mutate project state out of order.

Skill and API guidance:

- `tdd`
- Installed `google-cloud-firestore` 2.29 `AsyncTransaction.set`, `delete`, and `update` signatures were inspected before implementing the durable lock writes.

TDD evidence:

- Red: two pending mock jobs for the same workspace/channel could both be claimed.
- Green: the mock repository now owns one active job per project key under its existing async lock and releases ownership only after a successful complete, retry release, or terminal failure transition.
- Red: the Firestore repository likewise allowed two same-project jobs to transition to `running`.
- Green: claim now reads the job and hashed project-lock document before atomically writing both; a competing same-project claim remains pending until the owner completes.
- Green blast radius: retry release and both terminal transitions retain their existing behavior while deleting only the lock owned by that job.
- Review red: the worker treated a contended claim like an idempotent no-op, returned HTTP 200, and caused Cloud Tasks to delete the blocked job's task while the job remained pending.
- Review green: repositories now distinguish project contention with `ProjectBusyError`; worker ingress translates only that condition to HTTP 503, and an HTTP integration test proves the blocked task succeeds on redelivery after the active job completes.

Safety and scope:

- The serialization key is derived from the authorized Slack workspace/channel mapping, not request text, project names, target URLs, or feature-specific data.
- Firestore lock document IDs contain only a SHA-256 digest of the scope; raw workspace/channel values are not placed in document paths.
- Lifecycle transitions verify lock ownership in the same transaction before deleting it, preventing one job from releasing another job's lock.
- Live mode requires `FIRESTORE_JOB_LOCKS_COLLECTION`; mock mode remains self-contained with its in-memory lock map and visible mock badge.
- No cloud call, resource, deployment, secret, model, or live integration was used.
- Stale-lock lease recovery and coordinator/onboarding composition remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_firestore_job_repository.py tests/integration/test_slack_onboarding_ingress.py -q` — `19 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_onboarding_ingress.py -q` — `31 passed` after the review fix.
- `uv run pytest tests/integration/test_slack_ingress_app.py -q` — `16 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `57 passed` after the review fix.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for project-level serialization with durable Firestore locks, mock parity, and explicit live configuration.

## 2026-09-02 — Phase 3: stale project-lock recovery

Isolated change: added bounded execution leases so Cloud Tasks redelivery remains retryable while a job is active and the same running job can be reclaimed after an ungraceful worker loss.

Reason: cancellation and timeout cleanup cannot run if a worker process disappears. Without a recoverable lease, the durable job and project lock would remain `running` forever across Cloud Run restarts.

Skill and API guidance:

- `tdd`
- Reused the installed Firestore transaction seam from the serialization slice; lease reads and renewal writes stay inside the same transaction.

TDD evidence:

- Red: the in-memory repository had no clock or lease and treated a running job's redelivery as a completed no-op.
- Green: active same-job delivery raises `ProjectBusyError`; after the bounded lease expires, the owner renews its lease and returns the canonical running job for processing.
- Red: Firestore settings rejected a lease duration and running jobs could never be reclaimed.
- Green: Firestore persists `lease_expires_at`, retries active owners, and atomically renews an expired owner with a server recovery timestamp.
- Worker boundary: a persisted running job returns HTTP 503 before expiry, then the next delivery processes and completes it after deterministic clock advancement.
- Red: live composition silently inherited a default lease instead of declaring its relationship to the worker budget.
- Green: live mode now requires `FIRESTORE_JOB_LEASE_SECONDS=960`, sixty seconds beyond the maximum 900-second processor budget; mock mode remains self-contained.

Safety and scope:

- Lease duration is bounded to greater than 900 and at most 3600 seconds.
- A different job never steals an expired lock; only the recorded owner can recover it, preserving project ordering.
- Completed and failed redeliveries remain idempotent acknowledgements rather than retries.
- Lock timestamps contain no Slack text, URL, credential, exception, or secret-bearing value.
- No cloud call, resource, deployment, secret, model, or live integration was used.
- Queue retry/backoff infrastructure and coordinator/onboarding composition remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_firestore_job_repository.py tests/integration/test_slack_onboarding_ingress.py -q` — `21 passed`.
- `uv run pytest tests/integration/test_slack_ingress_app.py -q` — `17 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py::test_worker_recovers_running_job_after_lease_expiry -q` — `1 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/unit -q` — `61 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded stale-lock recovery with mock, Firestore, worker-boundary, and explicit live-configuration evidence.

## 2026-09-02 — Phase 3: same-thread Slack progress adapter

Isolated change: added a typed Slack progress adapter that posts one onboarding status message under the originating Slack message and updates that same bot-authored message through bounded stages, plus an inspectable in-memory implementation for mock mode.

Reason: the onboarding acceptance path requires concise progress in the original thread without creating a stream of messages or exposing internal IDs and arbitrary workflow text.

Skill and official guidance:

- `tdd`
- Slack `chat.postMessage` documentation: the parent message timestamp is supplied as `thread_ts` to create a thread reply.
- Slack `chat.update` documentation: the bot-authored progress message is updated by its channel and returned message `ts` using the `chat:write` scope.
- Installed `slack_sdk.web.async_client.AsyncWebClient` signatures were inspected before defining the client protocol.

TDD evidence:

- Red: no progress adapter module existed.
- Green: `SlackProgressReporter.start` posts the fixed received state once with link/media unfurling disabled and returns a typed channel/thread/message reference; `update` targets that same message timestamp.
- Red: local mock mode had no token-free progress implementation.
- Green: `InMemorySlackProgressReporter` mirrors start/update behavior under an async lock and exposes one record with a visible `MOCK MODE` badge.

Safety and scope:

- Runtime callers choose only `OnboardingProgressStage` values; they cannot send arbitrary model text, job IDs, source content, URLs, or secret-bearing error details through this adapter.
- Slack API responses must contain a non-empty message timestamp before an updateable reference is returned.
- No Slack token is read or stored by the adapter model; the production factory accepts an injected token and creates the installed async client without making a call.
- No live Slack call, cloud call, resource, deployment, secret, or model was used.
- Persisting the progress reference with workflow state and composing it into the onboarding processor remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_slack_progress.py -q` — `2 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/unit -q` — `63 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded same-thread Slack progress reporting with production adapter and mock parity.

## 2026-09-02 — Phase 3: durable Slack progress reference

Isolated change: added immutable progress-message reference persistence to the Firestore production job repository and the in-memory mock repository.

Reason: a retried or restarted onboarding worker must update the existing Slack progress message rather than post another message and fragment the workflow history.

Skill and method:

- `tdd`
- Reused the existing transactional Firestore job seam and typed `ProgressMessage` contract from the preceding adapter slice.

TDD evidence:

- Red: the mock job repository could not bind or recover a progress message across retry release and reclaim.
- Green: a running mock job binds one channel/thread/message reference, preserves it across retry, and rejects a replacement timestamp.
- Red: the Firestore production repository had no durable attach/read operations.
- Green: Firestore atomically attaches the first progress timestamp only to the matching running job and reconstructs the typed reference from canonical stored channel/thread fields after retry.
- Immutability guard: both implementations accept an idempotent repeat of the same reference but reject attempts to bind a different message.

Safety and scope:

- Attachment requires the progress channel and parent thread to match the canonical job; a redelivered task payload cannot redirect updates elsewhere.
- Firestore stores only the bot-message timestamp plus a server attachment timestamp; it does not duplicate Slack text, project sources, job text, URLs, or secrets.
- Completed, failed, missing, and non-running jobs cannot acquire a new progress reference.
- No Slack API call, cloud call, resource, deployment, secret, or model was used.
- Creating/reusing the reference inside the onboarding processor remains the next composition slice.

Commands and evidence:

- `uv run pytest tests/integration/test_firestore_job_repository.py tests/integration/test_slack_onboarding_ingress.py -q` — `23 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/unit -q` — `65 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for immutable durable Slack progress references with Firestore and mock parity.

## 2026-09-02 — Phase 3: onboarding progress composition

Isolated change: composed the injected onboarding processor with durable Slack progress creation, retry reuse, bounded status transitions, and the existing in-memory mock reporter.

Reason: the worker must expose one concise status message in the originating Slack thread while keeping lifecycle control deterministic and avoiding a second message after a normal processor retry.

Skill and official guidance:

- `tdd`
- Slack `chat.postMessage` documentation and the installed Python SDK were inspected for message-idempotency support before defining the boundary.
- The official method reference exposes duplicate-message errors related to `client_msg_id`, but the installed typed SDK signature does not provide a sufficiently explicit durable-idempotency contract for Qali to treat a post-before-persist crash as solved.

TDD evidence:

- Red: no onboarding progress composition module existed.
- Green: the wrapper creates and durably attaches one progress reference, advances it through reviewing sources, delegates the typed onboarding job, and marks the same message ready.
- Red: a delegate failure left the progress message at reviewing sources.
- Green: a delegate failure updates the bounded failed state and re-raises so the existing lifecycle handler retains retry ownership.
- Red: a retry posted a second mock message and then failed the immutable attachment guard.
- Green: retries read the durable reference first, update the existing message, and complete with exactly one mock progress record.

Safety and scope:

- The wrapper emits only fixed `OnboardingProgressStage` values; exception text, request text, URLs, credentials, and model output never enter Slack progress content.
- Cancellation remains owned by the lifecycle handler and is not mislabeled as a processor failure.
- The post-before-attach crash window remains explicit; no undocumented Slack behavior is treated as an exactly-once guarantee.
- No Slack API call, cloud call, resource, deployment, secret, browser, or model was used.
- Wiring the Knowledge Analyst and knowledge-quality workflow into the injected delegate remains a separate slice.

Commands and evidence:

- `uv run pytest tests/integration/test_onboarding_processor.py -q` — `3 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/unit -q` — `69 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic onboarding progress composition with durable retry reuse and mock-visible status evidence.

## 2026-09-02 — Phase 3: onboarding source URL policy

Isolated change: added a deterministic, project-configured source URL policy for onboarding HTTPS sources.

Reason: onboarding must reject unapproved or non-public source targets before any fetch adapter can retrieve project material, while remaining project-agnostic and testable without network access.

Skill and method:

- `tdd`
- Reused Python standard-library URL parsing and IP-address classification rather than introducing another network or validation dependency.

TDD evidence:

- Red: no source URL policy module existed.
- Green: an approved HTTPS source is normalized to its lowercase exact origin while preserving its path and query and dropping the client-only fragment.
- Red: embedded URL credentials were silently removed during normalization.
- Green: username or password userinfo is rejected before any normalized URL is returned.
- Red: loopback, private, link-local, IPv6 loopback, and Google metadata targets could pass when configured as approved origins.
- Green: non-global IP literals and the metadata hostname are rejected before origin approval.
- Red: the policy had no seam for fetch-time DNS evidence.
- Green: adapters can supply all resolved addresses, and any invalid or non-global result fails closed.

Safety and scope:

- HTTPS and an exact onboarding-configured origin are both required; approvals are project data, never hardcoded product or feature names.
- Hostname parsing alone is not treated as SSRF protection. The future fetch adapter must supply every resolved address and call the same policy again for each redirect.
- The policy performs no DNS lookup, HTTP request, file access, cloud call, deployment, secret read, browser action, or model invocation.
- Safe bounded fetching, redirect enforcement, content limits, and immutable raw-source persistence remain separate slices.

Commands and evidence:

- `uv run pytest tests/unit/test_source_url_policy.py -q` — `10 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/unit -q` — `79 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic HTTPS/origin/host safety policy with explicit DNS and redirect enforcement seams.

## 2026-09-02 — Phase 3: bounded onboarding source fetcher

Isolated change: added a deterministic source-fetch orchestration boundary that resolves and validates every HTTPS hop, binds transport calls to approved public addresses, limits redirects and response bytes, and accepts only onboarding document media types.

Reason: source ingestion must remain fail-closed across DNS resolution and redirects without using live network access during TDD or letting a generic HTTP client silently re-resolve an approved hostname.

Skill and method:

- `tdd`
- Kept resolution and the address-bound transport behind narrow protocols so integration tests exercise the complete policy flow with test-only doubles.

TDD evidence:

- Red: no source fetch adapter existed.
- Green: an approved source is normalized, resolved, revalidated with all returned addresses, fetched through a byte-bounded address-aware transport, and returned as typed content.
- Red: redirects were handled as generic HTTP failures.
- Green: redirects are bounded and every next URL is policy-validated before another DNS or transport call.
- Red: title-cased HTTP response headers prevented valid redirect and content-type handling.
- Green: response header names are normalized case-insensitively at each hop.
- Red: an empty DNS result reached the transport with no approved addresses.
- Green: unresolved hosts fail before any transport request.
- Red: arbitrary binary media types were accepted.
- Green: only HTML, plain text, Markdown, and PDF sources are returned; the adapter also verifies the response body remains within the configured byte cap.

Safety and scope:

- The transport protocol receives the complete approved address tuple and maximum byte count. A production implementation must connect only to those addresses and must not independently re-resolve the hostname.
- Every redirect repeats URL normalization, exact-origin approval, DNS resolution, public-address validation, and bound transport invocation.
- Redirect count is configurable from zero to five; response bodies are checked even when the transport claims to enforce the limit.
- No live DNS lookup, HTTP request, cloud call, deployment, secret, browser action, file write, or model invocation was used.
- The production resolver/transport, malware and prompt-injection screening, and immutable raw-source storage remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_source_fetcher.py -q` — `6 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/integration/test_source_fetcher.py tests/unit -q` — `85 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded, redirect-aware source-fetch orchestration with explicit address-binding and mock-safe evidence.

## 2026-09-03 — Phase 3: production source network adapters

Isolated change: added the production system-DNS resolver and aiohttp HTTPS
transport required by the bounded onboarding source fetcher.

Reason: validating DNS results before a request is insufficient if the HTTP
client resolves the hostname again. The production transport must preserve the
original URL hostname for the HTTP Host header and TLS verification while
connecting only to the exact address set already approved by `SourceUrlPolicy`.

Skill and official guidance:

- `tdd`
- aiohttp's `AbstractResolver` and `TCPConnector` documentation for custom DNS
  resolution, plus its streaming response API for bounded reads.
- Installed aiohttp 3.14.3 signatures and resolver result shape were inspected
  before implementation.

TDD evidence:

- Red: no production resolver or network transport existed.
- Green: `SystemSourceResolver` converts OS address records into stable,
  deduplicated numeric IPv4/IPv6 strings for policy validation.
- Red: aiohttp had no resolver constrained to the policy-approved address set.
- Green: `ApprovedAddressResolver` returns only numeric pinned endpoints for the
  expected hostname and never falls back to system DNS.
- Red: the bounded fetcher protocol had no production HTTPS implementation.
- Green: `AiohttpBoundSourceTransport` reaches a deliberately non-resolving
  `.test` hostname through its injected approved address while validating a TLS
  certificate for the original hostname and preserving its Host header.
- Guard cases prove a hostname-mismatched certificate is rejected, redirects
  are returned without being followed, and decoded response content exceeding
  the byte cap is aborted.

Safety and scope:

- Each request owns a one-connection, force-closed connector with DNS caching
  disabled and a resolver containing only the approved address tuple.
- Automatic redirects and environment-derived proxies are disabled; the outer
  fetcher remains responsible for revalidating every redirect hop.
- TLS certificate verification is enabled by default and the original hostname
  is supplied explicitly for SNI/hostname checking.
- Response content is streamed into a bounded buffer with identity encoding
  requested; the decoded body cannot be returned above the configured cap.
- The cryptography package is a development-only dependency used to generate
  ephemeral local test certificates; no private key or certificate fixture is
  committed.
- No live DNS lookup, external HTTP request, cloud call, resource, deployment,
  secret, browser action, or model invocation was used.
- Source screening, immutable raw-source persistence, and onboarding workflow
  composition remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_source_network.py tests/integration/test_source_fetcher.py tests/unit/test_source_url_policy.py -q` — `22 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/integration/test_source_fetcher.py tests/integration/test_source_network.py tests/unit -q` — `91 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.
- `uv run pytest tests/unit tests/integration -q -x` — the new and existing offline tests passed until the unchanged generated `tests/integration/test_agent.py` attempted a live Gemini call and failed because no API key was supplied. No live key was introduced for this slice.

Phase result: passed for production DNS resolution and address-pinned HTTPS transport with local TLS integration evidence and the offline regression gate.

## 2026-09-03 — Phase 3: fail-closed source screening boundary

Isolated change: added the typed screening boundary that every fetched onboarding
source must pass before it can become eligible for immutable raw-source
persistence.

Reason: URL and transport safety do not establish that downloaded content is
safe to ingest. Malware and instruction/prompt-injection screening must be
independent, ordered, auditable, and fail closed without leaking source content
or scanner failure details.

Skill and recipe guidance:

- `tdd`
- `google-agents-cli-workflow` 1.4.2 and `google-agents-cli-adk-code` 1.4.2.
- Reused the previously recorded `safety-plugins` runner-wide rejection and
  session-poisoning principles, and the `long-horizon-harness` ordered guard-chain
  principle. The implementation remains deterministic application code rather
  than an agent callback or model verdict.
- `uv run agents-cli info` confirmed the generated Qali project, Python agent
  directory, A2A support, `europe-west1`, no deployment target, and CLI 1.4.2.

TDD evidence:

- Red: no public source-screening module or typed verdict existed.
- Green: a source becomes `ScreenedSource` only after clean malware and
  instruction-scanner decisions are both recorded.
- Red: a malware verdict had no way to stop ingestion before later processing.
- Green: the ordered chain rejects immediately and exposes only typed decisions
  plus a constant, content-free error message.
- The generalized ordered implementation also rejects a prompt-injection verdict
  while preserving both completed decisions for audit.
- Red: scanner outages propagated arbitrary vendor exceptions that could contain
  source data or sensitive diagnostics.
- Green: scanner failures become a redacted `SourceScreeningUnavailable` result
  identifying only the failed stage; later stages do not receive the source.

Safety and scope:

- Scanner integrations sit behind a narrow async protocol and are injected at
  the system boundary. Service doubles exist only in integration tests.
- Empty threat tuples are the only approval signal. Any recorded malware or
  prompt-injection threat rejects the source before persistence.
- Rejection and unavailability messages contain no URL, source bytes, scanner
  exception, credential, or external response body.
- Cancellation is not swallowed because only ordinary scanner exceptions are
  converted to fail-closed unavailability.
- No live scanner, model, network request, cloud call, resource, deployment, or
  secret was used. Production scanner adapters, immutable GCS raw-source
  persistence, and onboarding composition remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_source_screening.py -q` — `4 passed`.
- `uv run pytest tests/integration/test_source_screening.py tests/integration/test_source_network.py tests/integration/test_source_fetcher.py tests/unit/test_source_url_policy.py -q` — `26 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/integration/test_source_fetcher.py tests/integration/test_source_network.py tests/integration/test_source_screening.py tests/unit -q` — `95 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for the fail-closed screening orchestration contract with
ordered malware/instruction verdicts, redacted failures, test-only scanner
doubles, and the offline regression gate.

## 2026-09-03 — Phase 3: immutable raw-source GCS repository

Isolated change: added the production-shaped GCS repository that accepts only a
completely screened onboarding source and writes its raw bytes once under the
project-scoped `raw/{source_id}` prefix with immutable provenance metadata.

Reason: approved source bytes and provenance must survive worker retries without
allowing overwrite, path escape, unsafe-content bypass, or signed URL leakage.
This is the durable boundary required before the Knowledge Analyst can compile
cited project knowledge.

Skill, SDK, and reference guidance:

- `tdd`
- `google-agents-cli-workflow` 1.4.2 and `google-agents-cli-adk-code` 1.4.2.
- Preserved the approved GCS adaptation of the explicit write/read lifecycle in
  `cross-session-memory`; Qali raw sources remain authoritative project artifacts,
  not conversational memory or ADK session artifacts.
- Inspected the installed `google-cloud-storage` 3.13.1
  `Blob.upload_from_string`, `Blob.reload`, `Client.bucket`, and `Bucket.blob`
  signatures before implementation. Declared the SDK as a direct runtime
  dependency and refreshed `uv.lock`.

TDD evidence:

- Red: no project-scoped raw-source repository existed.
- Green: clean screened bytes are uploaded with content type, SHA-256,
  capture-time, author reference, redacted source URI, and screening identities;
  `if_generation_match=0` enforces create-only storage.
- Red: a manually constructed `ScreenedSource` containing a threat could reach
  the storage client.
- Green: persistence independently rejects threats before selecting a bucket.
- Red: clean decisions did not prove both required stages had run.
- Green: `SourceScreeningDecision` now carries a typed stage and both screening
  and persistence enforce the exact malware-then-instruction sequence.
- Red: unsafe project/source identifiers could escape the prescribed object
  prefix because the initial adapter configuration did not enforce its pattern.
- Green: explicit full-match validation rejects traversal and unsafe identifiers
  before any GCS operation.
- Red: an identical retry received GCS's generation precondition error, and its
  newly calculated timestamp differed from the immutable object's timestamp.
- Green: the repository reloads existing metadata, accepts only stable identity
  matches, and returns the original capture time for an idempotent retry.
- Red: the same source ID could surface a vendor exception when different bytes
  attempted to overwrite it.
- Green: different content or provenance produces a constant, redacted
  `RawSourceConflict`; the existing object remains unchanged.
- Red: signed query parameters were persisted in source provenance.
- Green: stored provenance contains only scheme, authority, and path; a SHA-256
  correlation value distinguishes the full fetched URI without storing it.

Safety and scope:

- The GCS client is behind narrow protocols and synchronous SDK calls run in a
  worker thread so the async workflow loop is not blocked. Tests use only
  in-process service doubles.
- Object names are fixed to `projects/{project_id}/raw/{source_id}/source`, and
  both identifiers are constrained before interpolation.
- Raw bytes are never rewritten. Only an identical content/provenance retry may
  reuse an existing object after metadata verification.
- Metadata contains no source query, fragment, raw bytes, scanner exception,
  credential, or signed URL. Scanner stage identities are explicit and ordered.
- No bucket, cloud resource, deployment, credential, live network request, model,
  or external GCS operation was created or used. Firestore source indexing,
  production scanner adapters, and onboarding workflow composition remain
  separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_raw_source_repository.py tests/integration/test_source_screening.py -q` — `12 passed`.
- `uv run pytest tests/integration/test_raw_source_repository.py tests/integration/test_source_screening.py tests/integration/test_source_network.py tests/integration/test_source_fetcher.py tests/unit/test_source_url_policy.py -q` — `34 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/integration/test_source_fetcher.py tests/integration/test_source_network.py tests/integration/test_source_screening.py tests/integration/test_raw_source_repository.py tests/unit -q` — `103 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for immutable, project-scoped raw-source persistence with
complete screening enforcement, create-only GCS writes, idempotent retries,
redacted provenance, explicit collision failure, and the offline regression gate.

## 2026-09-03 — Phase 3: durable source metadata index

Isolated change: added the Firestore repository that indexes immutable raw-source
artifact pointers and their redacted provenance without copying source bytes into
the operational database.

Reason: later onboarding phases need a durable project/source lookup boundary
that survives worker restarts and can correlate compiled knowledge citations to
the authoritative GCS object. The index must remain create-only and safe under
Cloud Tasks redelivery.

Skill and SDK guidance:

- `tdd`
- Reused the existing Firestore job repository's injected-client, create-only
  document, server-timestamp, and deterministic hashed-ID conventions.
- Used the installed `google-cloud-firestore` async document/client interfaces;
  the dependency and production project/database configuration already exist.

TDD evidence:

- Red: no Firestore source metadata repository existed.
- Green: `FirestoreSourceRepository.create` writes the typed
  `RawSourceArtifact` metadata plus a server-side index timestamp under a stable,
  hashed project/source document ID. Raw source bytes are absent by construction.
- Red: an existing document was treated as a harmless duplicate without proving
  that it described the same immutable artifact.
- Green: duplicate creation reloads and schema-validates the stored artifact;
  identical metadata is an idempotent retry and any drift produces a constant,
  redacted `FirestoreSourceConflict` without mutating the document.

Safety and scope:

- The repository stores only the GCS pointer, redacted source URI and hash,
  content hash/type, immutable capture time, author reference, and screening
  identities. It cannot receive or serialize raw source bytes.
- Document IDs hash both the Qali project and source IDs, avoiding unsafe path
  interpolation and keeping retries deterministic across worker restarts.
- Firestore access remains behind narrow protocols with test-only in-process
  doubles. The production factory uses the configured GCP project and database.
- No live Firestore call, cloud resource, deployment, credential, model, or
  external integration was used. Workflow composition and knowledge compilation
  remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_firestore_source_repository.py -q` — `3 passed`.
- `uv run pytest tests/integration/test_firestore_source_repository.py tests/integration/test_raw_source_repository.py tests/integration/test_source_screening.py tests/integration/test_firestore_job_repository.py -q` — `26 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_firestore_source_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/integration/test_source_fetcher.py tests/integration/test_source_network.py tests/integration/test_source_screening.py tests/integration/test_raw_source_repository.py tests/unit -q` — `106 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for create-only, idempotent Firestore source metadata indexing
with schema-validated collision detection, redacted artifact pointers, test-only
doubles, and the offline regression gate.

## 2026-09-03 — Phase 3: onboarding source-ingestion composition

Isolated change: added the deterministic application service that composes one
approved onboarding URL through bounded fetch, ordered screening, immutable raw
GCS persistence, and durable Firestore metadata indexing.

Reason: the individually verified source boundaries did not yet provide one
workflow contract that guarantees unsafe content stops before persistence and a
successful result is returned only after both durable stores accept the artifact.

Skill and architecture guidance:

- `tdd`
- Kept workflow sequencing in deterministic application code per the approved
  coordinator/custom-logic decision. No LLM or ADK agent decides whether a source
  is safe, where it is stored, or whether indexing completed.
- External network, scanner, GCS, and Firestore operations remain behind their
  existing narrow protocols. Integration tests compose test-only boundary doubles.

TDD evidence:

- Red: no public service connected fetch, screen, raw persistence, and metadata
  indexing.
- Green: `OnboardingSourceIngestionService.ingest` accepts a typed project/source
  request, passes each typed result to the next boundary, indexes the exact
  immutable artifact returned by GCS persistence, and returns only after indexing.
- The first implementation generalized safely to the next behavior: a screening
  rejection propagates and neither GCS persistence nor Firestore indexing receives
  the rejected source.

Safety and scope:

- The request contains only project/source identifiers, an approved URL, and an
  author reference. Credentials and raw secret values are not part of the schema.
- Screening precedes every durable write. Firestore receives only the redacted
  artifact metadata returned by the raw repository, never the fetched bytes.
- Existing create-only and duplicate-verification behavior in both repositories
  preserves retry safety; changed source content or metadata still fails closed.
- No live fetch, scanner, bucket, Firestore call, cloud resource, deployment,
  credential, model, or browser operation was used. Job-level source extraction,
  multi-source handling, and Knowledge Analyst compilation remain separate slices.

Commands and evidence:

- `uv run pytest tests/integration/test_source_ingestion.py -q` — `2 passed`.
- `uv run pytest tests/integration/test_source_ingestion.py tests/integration/test_firestore_source_repository.py tests/integration/test_raw_source_repository.py tests/integration/test_source_screening.py tests/integration/test_source_fetcher.py tests/unit/test_source_url_policy.py -q` — `33 passed`.
- `uv run pytest tests/integration/test_cloud_tasks_worker.py tests/integration/test_cloud_tasks_dispatcher.py tests/integration/test_slack_ingress_app.py tests/integration/test_slack_onboarding_ingress.py tests/integration/test_firestore_job_repository.py tests/integration/test_firestore_source_repository.py tests/integration/test_slack_progress.py tests/integration/test_onboarding_processor.py tests/integration/test_source_fetcher.py tests/integration/test_source_network.py tests/integration/test_source_screening.py tests/integration/test_raw_source_repository.py tests/integration/test_source_ingestion.py tests/unit -q` — `108 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic fetch-screen-persist-index composition with
typed handoffs, zero-write rejection behavior, mock-safe integration evidence, and
the offline regression gate.

## 2026-09-04 — Phase 3: Slack onboarding source extraction

Isolated change: added deterministic extraction of project-agnostic source text
and HTTPS links from the existing typed Slack onboarding job.

Reason: the ingestion service needs stable, provenance-bearing source descriptors
before a later workflow slice can supply project mapping and ingest each approved
URL. Source discovery must not guess the target application's features or policy.

Skill and architecture guidance:

- `tdd`
- Kept parsing and identity generation in deterministic application code. No LLM,
  live Slack request, network fetch, or storage integration is needed to turn the
  accepted job into typed source descriptors.

TDD evidence:

- Red: the public `app.onboarding_source_extraction` module did not exist.
- Green: Slack command syntax and formatted HTTPS links are removed from the
  residual text, while source text, author provenance, URLs, and stable IDs are
  returned through frozen, extra-forbidding schemas.
- Red: punctuation left after a URL-only request was incorrectly emitted as a
  text source.
- Green: URL-only requests omit punctuation-only text; duplicate URLs preserve
  first-seen order and retries produce identical typed output.

Safety and scope:

- Only explicit HTTPS links become fetchable URL descriptors. Plain HTTP remains
  inert text, and downstream URL policy still owns origin and SSRF validation.
- IDs include the immutable Slack event ID, making Cloud Tasks retries stable
  without conflating a later onboarding event with an earlier snapshot.
- The extractor does not assign a project, infer features, approve origins, fetch
  content, persist data, or expose credentials.
- No live Slack call, network request, cloud resource, deployment, credential,
  model, or external integration was used.

Commands and evidence:

- `uv run pytest tests/unit/test_onboarding_source_extraction.py -q` — `3 passed`.
- `uv run pytest tests/unit/test_onboarding_source_extraction.py tests/integration/test_source_ingestion.py tests/integration/test_slack_onboarding_ingress.py tests/unit/test_source_url_policy.py -q` — `28 passed`.
- Complete explicit offline unit/integration gate — `111 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic Slack text/HTTPS extraction, provenance,
deduplication, retry-stable IDs, mock-safe evidence, and the offline regression
gate.

## 2026-09-04 — Phase 3: durable project/channel mapping

Isolated change: added a Firestore repository that resolves one Slack
workspace/channel pair to one deterministic Qali project identity.

Reason: source extraction is intentionally project-agnostic, while durable raw
and knowledge paths require a stable project scope. The mapping separates the
GCP infrastructure project from each target application onboarded through Slack.

Skill and architecture guidance:

- `tdd`
- Reused the existing Firestore repositories' injected-client, hashed document
  identity, create-only write, server timestamp, and schema-validation patterns.

TDD evidence:

- Red: no project/channel repository or public binding schema existed.
- Green: `resolve_or_create` derives stable project and document IDs from the
  Slack workspace/channel scope and creates a typed binding with creator
  provenance.
- Red: a repeated channel mapping raised Firestore `AlreadyExists` without
  distinguishing a valid lookup from corrupt or conflicting stored metadata.
- Green: a later requester receives the original typed binding, while missing,
  malformed, or scope-conflicting metadata fails closed without replacement.

Safety and scope:

- Raw Slack identifiers never become Firestore document paths or storage project
  paths; SHA-256-derived identifiers provide a fixed, safe namespace.
- `gcp_project_id` names only the Firestore client host project. The returned
  `project_id` identifies the onboarded target and contains no website, feature,
  or qualification-fixture assumption.
- Create-only writes preserve the original creator and prevent a later caller
  from remapping an established Slack channel.
- No live Firestore call, cloud resource, deployment, credential, model, source
  ingestion, or external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_firestore_project_repository.py -q` — `3 passed`.
- Focused Firestore and extraction regression gate — `20 passed`.
- Complete explicit offline unit/integration gate — `114 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for durable, create-only Slack channel mapping with stable
target-project identity, idempotent reuse, conflict detection, test doubles, and
the offline regression gate.

## 2026-09-04 — Phase 3: screened Slack text ingestion

Isolated change: extended the source-ingestion application service to accept
bounded Slack text as an inline source and route it through the existing
screen-persist-index pipeline without a network fetch.

Reason: onboarding text is an immutable project source just like approved web
content. It must receive the same injection/malware decisions, GCS persistence,
and Firestore metadata indexing without pretending Slack content is an HTTPS URL.

Skill and architecture guidance:

- `tdd`
- Reused the deterministic source screening and storage contracts. Inline source
  adaptation is custom application logic; scanners and durable stores remain
  injected boundaries with test-only doubles.

TDD evidence:

- Red: the ingestion service exposed only URL requests and had no typed inline
  request or `ingest_inline` operation.
- Green: bounded Slack text becomes UTF-8 `text/plain`, bypasses the network
  fetcher, and then follows the same ordered screening and durable-write path as
  fetched content.

Safety and scope:

- Inline requests cap text at 20,000 characters and Slack scope fields at 256
  characters before any scanner or storage operation.
- The stored source URI contains only a SHA-256 digest of workspace, channel, and
  event scope. Raw Slack identifiers are not exposed in artifact URIs.
- Screening still completes before GCS or Firestore receives the source, and the
  existing shared rejection behavior remains fail closed.
- No live Slack call, scanner, network request, GCS/Firestore call, cloud resource,
  deployment, credential, model, or external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_source_ingestion.py -q` — `4 passed`.
- Focused source screening/persistence/extraction regression gate — `19 passed`.
- Complete explicit offline unit/integration gate — `116 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded, no-fetch Slack text ingestion through the same
screening and durable persistence pipeline, with redacted provenance, test-only
doubles, and the offline regression gate.

## 2026-09-04 — Phase 3: bounded onboarding source flow

Isolated change: composed Slack source extraction, durable channel mapping, and
the verified text/URL ingestion operations behind one onboarding processor.

Reason: the worker's progress wrapper requires one project-agnostic delegate that
turns an accepted Slack job into durable source artifacts while enforcing source
presence and count before creating project state or performing external work.

Skill and architecture guidance:

- `tdd`
- Kept extraction, bounds, project resolution, and ingestion ordering in
  deterministic custom logic. Firestore, HTTP, scanners, and GCS remain behind
  their existing injected protocols and test-only doubles.

TDD evidence:

- Red: no public processor composed the independently verified project and source
  boundaries.
- Green: `OnboardingSourceFlow.process` extracts once, validates the batch, creates
  or resolves the target-project binding, ingests Slack text first, and then
  ingests deduplicated HTTPS sources in stable order.
- Empty requests and batches above the configured limit fail before project
  creation, source fetching, scanning, or durable source writes.

Safety and scope:

- The default batch limit is 10 sources and configuration is hard-bounded from 1
  through 20, limiting fan-out even when upstream Slack input is adversarial.
- Partial retries remain safe because project, raw artifact, and source metadata
  repositories are create-only and validate identical retries.
- The flow derives no website, feature, expected behavior, credential, or allowed
  origin. Downstream URL policy remains the only HTTPS approval boundary.
- No live Slack, Firestore, HTTP, scanner, GCS, cloud resource, deployment,
  credential, model, or external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_onboarding_source_flow.py -q` — `3 passed`.
- Focused project/extraction/ingestion composition gate — `13 passed`.
- Complete explicit offline unit/integration gate — `119 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded, deterministic Slack-job source composition with
preflight rejection, stable ingestion order, retry-safe boundaries, test-only
doubles, and the offline regression gate.

## 2026-09-04 — Phase 3: verified raw source retrieval

Isolated change: added integrity-checked reads of immutable raw source objects for
the future Knowledge Analyst input boundary.

Reason: compiled knowledge may cite only authoritative source bytes. A stored
Firestore pointer alone cannot prove that the referenced GCS object, metadata, or
content has remained consistent with the accepted artifact record.

Skill and architecture guidance:

- `tdd`
- Extended the existing generated-client adapter rather than exposing GCS to an
  agent. The repository returns one frozen snapshot only after deterministic
  identity, metadata, and content verification.

TDD evidence:

- Red: the raw repository supported immutable creation but no read operation or
  integrity-failure contract.
- Green: `read` derives the only allowed object path from validated project/source
  IDs, checks the supplied artifact pointer, reloads object metadata, downloads
  bytes with checksum handling, and verifies the artifact SHA-256 before returning.
- Changed content or provenance metadata produces the same constant, redacted
  `RawSourceIntegrityError` and returns no snapshot.

Safety and scope:

- Callers cannot redirect a read outside `projects/{project_id}/raw/{source_id}`;
  unsafe resource IDs or mismatched object names fail before GCS access.
- Author, capture time, content hash, redacted source URI and hash, and screening
  scanner identities must all match the immutable artifact record.
- The snapshot preserves the typed artifact beside its exact verified bytes so
  later knowledge citations can retain source identity and provenance.
- No live GCS call, source content, cloud resource, deployment, credential, model,
  agent invocation, or external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_raw_source_repository.py -q` — `10 passed`.
- Focused raw/index/ingestion regression gate — `17 passed`.
- Complete explicit offline unit/integration gate — `121 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for path-bound, metadata-verified, hash-verified raw source
retrieval with redacted failures, frozen snapshots, test-only GCS doubles, and the
offline regression gate.

## 2026-09-04 — Phase 3: knowledge grounding and readiness gate

Isolated change: added the typed Knowledge Analyst output contract and a
deterministic policy that separates grounded readiness from insufficient project
knowledge.

Reason: an agent's prose or self-reported confidence cannot make onboarding ready.
Every fact and contradiction must cite an available immutable source, while sparse
or uncertain results must produce explicit, machine-readable insufficiency reasons.

Skill and architecture guidance:

- `tdd`
- Followed the approved ADK boundary: agent output is represented by strict
  schemas, while citation validation and the readiness verdict remain deterministic
  application policy outside the model.

TDD evidence:

- Red: no Knowledge Analyst compilation schema, citation error, or readiness
  decision existed.
- Green: frozen, extra-forbidding contracts capture overview, grounded facts,
  explicit contradictions, gaps, and enumerated confidence.
- The policy marks sufficiently confident cited facts ready, reports ordered
  reasons for no facts, low confidence, and blocking gaps, and fails closed on any
  citation outside the supplied source identity set.

Safety and scope:

- Fact citations are mandatory and distinct; contradictions require at least two
  distinct source identities. All text and collection fields are size-bounded.
- Unknown citations raise one constant `KnowledgeGroundingError` rather than being
  represented as an ordinary insufficient result that could pass after wording
  changes.
- Confidence thresholds are explicit and configurable through a closed enum; no
  model prose, hidden reasoning, or target-specific rule influences readiness.
- No model invocation, source content, live storage call, cloud resource,
  deployment, credential, or external integration was used.

Commands and evidence:

- `uv run pytest tests/unit/test_knowledge_quality.py -q` — `3 passed`.
- Complete explicit offline unit/integration gate — `124 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for strict Knowledge Analyst output, source-set grounding,
deterministic readiness reasons, fail-closed invented citations, and the offline
regression gate.

## 2026-09-04 — Phase 3: deterministic knowledge Markdown

Isolated change: added a deterministic compiler from the gated knowledge schema to
the Markdown document that will become Qali's operational project knowledge index.

Reason: model-authored Markdown could alter headings, hide citations, or smuggle
untrusted source syntax into the knowledge structure. Rendering must be owned by
application code after schema and grounding validation.

Skill and architecture guidance:

- `tdd`
- Preserved the approved compiled-wiki pattern: the model supplies typed content,
  while deterministic code owns document structure, citation formatting,
  readiness metadata, and the content hash.

TDD evidence:

- Red: no public compiler or compiled-document contract existed.
- Green: `compile_knowledge_markdown` emits stable sections for overview, facts,
  contradictions, gaps, and readiness reasons, then returns frozen UTF-8 content
  with a reproducible SHA-256.
- Newlines and Markdown metacharacters in analyst text are neutralized, HTML is
  escaped, and unsafe citation identifiers fail before document generation.

Safety and scope:

- The compiler accepts only the strict `KnowledgeCompilation` and deterministic
  `KnowledgeQualityDecision` contracts; free-form model output cannot choose the
  document layout or omit readiness metadata.
- Citation IDs must satisfy the same bounded resource-ID shape used by durable raw
  source paths, preventing code-span or heading injection.
- Empty sections remain explicit rather than disappearing from the knowledge
  record, preserving visible gaps and contradictions.
- No model invocation, source retrieval, storage write, cloud resource, deployment,
  credential, or external integration was used.

Commands and evidence:

- Knowledge compiler and quality tests — `5 passed`.
- Complete explicit offline unit/integration gate — `126 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic, cited, structure-safe knowledge Markdown
with explicit readiness state, stable hashing, and the offline regression gate.

## 2026-09-04 — Phase 3: compiled knowledge storage

Isolated change: added optimistic, retry-safe GCS publication of the deterministic
project knowledge document at `knowledge/index.md`.

Reason: compiled knowledge is incrementally maintained operational truth. Initial
publication and later revisions must prevent lost updates, reject stale writers,
and distinguish an identical retry from different content.

Skill and architecture guidance:

- `tdd`
- Reused the production GCS adapter and generation-precondition conventions while
  keeping storage behind a narrow protocol with test-only client doubles.

TDD evidence:

- Red: deterministic compiled documents had no durable repository, generation
  contract, or conflict behavior.
- Green: `GcsKnowledgeRepository.publish` verifies the caller's content hash,
  writes `projects/{project_id}/knowledge/index.md` with an exact generation
  precondition, and returns a frozen artifact containing generation and timestamp.
- An identical redelivery reloads and byte-compares the existing object before
  returning its original generation; stale different content fails without an
  overwrite. A matching generation publishes an incremental revision.

Safety and scope:

- Project identifiers are validated before bucket access and cannot escape the
  project knowledge prefix.
- Retry acceptance requires matching metadata hash and exact bytes, rather than
  trusting mutable metadata alone.
- Negative or stale generations, mismatched input hashes, invalid clocks, missing
  generation metadata, and malformed retry timestamps fail closed.
- No live GCS call, source content, model invocation, cloud resource, deployment,
  credential, or external integration was used.

Commands and evidence:

- Knowledge repository/compiler/quality focused gate — `9 passed`.
- Complete explicit offline unit/integration gate — `130 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for generation-guarded compiled knowledge publication,
byte-verified retries, incremental updates, frozen artifact metadata, and the
offline regression gate.

## 2026-09-04 — Phase 3: bounded source text extraction

Isolated change: added one integrity-checking text adapter for verified TXT,
Markdown, HTML, and PDF onboarding snapshots.

Reason: the Knowledge Analyst requires bounded plain text rather than raw bytes or
active HTML. PDF parsing also needs explicit input, page, decompressed page-stream,
and output limits before it is safe to place behind an agent handoff.

Skill and reference guidance:

- `tdd`
- Consulted the current official pypdf 6.16.2 `PdfReader` and text-extraction
  documentation, including its recommendation to inspect page content-stream size
  before extraction. Added and locked `pypdf==6.16.2` through `uv`.

TDD evidence:

- Red: verified raw snapshots had no supported-content text adapter.
- Green: `SourceTextExtractor` rechecks the immutable content hash, strictly
  decodes TXT/Markdown, collects visible HTML text while excluding active/hidden
  containers, and extracts bounded PDF page text from an in-memory stream.
- Hash drift fails before parsing through one constant, redacted
  `SourceTextExtractionError`.

Safety and scope:

- Default limits are 5 MB input, 100,000 output characters, 50 PDF pages, and 2 MB
  decompressed content per PDF page; constructor limits prevent unsafe expansion.
- Encrypted PDFs, unsupported content types, invalid UTF-8, empty output, parser
  errors, and any exceeded bound fail closed.
- Returned text retains source identity and content type in a frozen,
  extra-forbidding contract. It is data only and grants no instruction authority.
- No live source, network fetch, model invocation, cloud resource, deployment,
  credential, or external integration was used.

Commands and evidence:

- `uv run pytest tests/unit/test_source_text_extraction.py -q` — `3 passed`.
- Complete explicit offline unit/integration gate — `133 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded, hash-verified TXT/Markdown/HTML/PDF extraction,
active-content exclusion, typed agent input, and the offline regression gate.

## 2026-09-04 — Phase 3: bounded knowledge workflow

Isolated change: composed the typed Knowledge Analyst, deterministic quality
policy, independent reviewer, safe Markdown compiler, and generation-guarded
repository behind one bounded application workflow.

Reason: onboarding knowledge may become operational only after grounded source
validation and independent review. Reviewer feedback may trigger one correction,
but repeated model/reviewer loops must be impossible.

Skill and architecture guidance:

- `tdd`
- Followed the approved Google ADK/custom-logic boundary: analyst and reviewer are
  narrow asynchronous specialist protocols, while revision count, grounding,
  readiness, compilation, and publication remain deterministic orchestration.

TDD evidence:

- Red: the independently verified analyst-output, quality, compiler, and repository
  boundaries had no workflow contract.
- Green: `KnowledgeWorkflow.run` accepts a bounded, distinct source set, invokes
  the analyst, validates project identity and citations, obtains an independent
  review, and publishes approved ready knowledge with the caller's generation.
- One reviewer rejection triggers exactly one typed analyst revision and a fresh
  policy/review pass. A second rejection stops without publication.
- Reviewer-approved insufficient knowledge remains an explicit result and is not
  published as operational project knowledge.

Safety and scope:

- Analysis tasks accept 1–20 distinct typed sources; expected storage generation
  is non-negative and project identity cannot change across the handoff.
- Rejections require bounded feedback, and result metadata proves whether the one
  permitted revision was used.
- Model-facing specialist implementations are not yet wired; tests use doubles
  confined to test code, and production composition remains a later slice.
- No live model, storage call, source, cloud resource, deployment, credential, or
  external integration was used.

Commands and evidence:

- Knowledge workflow/repository/quality/compiler focused gate — `13 passed`.
- Complete explicit offline unit/integration gate — `137 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for one-revision knowledge analysis and independent review,
deterministic grounding/readiness, publish-only-ready behavior, test-only doubles,
and the offline regression gate.

## 2026-09-04 — Phase 3: durable project source recovery

Isolated change: added project-scoped source metadata enumeration to the Firestore
repository so a restarted worker can reconstruct the ordered raw-source index.

Reason: immutable sources were durably stored and indexed, but the application
could not recover the project corpus after process state was lost. The knowledge
workflow therefore lacked a restart-safe bridge to its source artifacts.

TDD evidence:

- Red: repository tests failed because `list_for_project` and its integrity error
  did not exist.
- Green: one Firestore field query recovers typed artifacts, removes server-only
  index metadata, and returns them in stable capture-time/source-ID order.
- Malformed documents, cross-project results, duplicate source IDs, and naive
  timestamps fail closed instead of entering knowledge compilation.

Safety and scope:

- Firestore is accessed behind the existing injected client protocol; automated
  tests use only an async in-memory query double.
- No source bytes, live Firestore data, cloud resource, deployment, credential,
  model, network source, or other external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_firestore_source_repository.py -q` —
  `7 passed`.
- Complete explicit offline unit/integration gate — `141 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic, project-scoped source-index recovery and
fail-closed metadata integrity checks.

## 2026-09-04 — Phase 3: restart-safe knowledge source preparation

Isolated change: added the application bridge that reconstructs a bounded
`KnowledgeAnalysisTask` from Firestore-indexed source metadata and hash-verified
raw source snapshots.

Reason: durable source enumeration alone did not provide the Knowledge Analyst
with safe text after a worker restart. The new loader joins the existing source
index, immutable raw repository, text extractor, and typed workflow input without
granting any model direct storage access.

Skill guidance:

- `tdd`
- Used vertical red-green cycles and test doubles only at the Firestore/GCS
  repository boundaries; the production text extractor ran in every success case.

TDD evidence:

- Red/green 1: introduced the public loader and proved one indexed Markdown
  snapshot becomes a typed, normalized knowledge-analysis source.
- Red/green 2: an empty project corpus fails before any raw storage read.
- Red/green 3: more than 20 indexed artifacts fails before raw reads, matching
  the Knowledge Analyst task bound.
- Red/green 4: a raw repository response whose artifact differs from the indexed
  artifact fails closed before text enters analysis.
- Red/green 5: a cross-project index result fails before raw storage access,
  preserving project isolation even behind an alternate source-index adapter.

Safety and scope:

- Specialist agents receive only bounded `KnowledgeSourceText`; they cannot query
  Firestore, GCS, or unverified source bytes directly.
- No live storage, network source, model, cloud resource, deployment, credential,
  or external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_knowledge_source_loader.py -q` —
  `5 passed`.
- Source recovery/raw storage/extraction/knowledge-workflow blast radius —
  `28 passed`.
- Complete explicit offline unit/integration gate — `146 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for restart-safe, bounded, typed source preparation with
fail-closed empty, oversized, and substituted-snapshot behavior.

## 2026-09-04 — Phase 3: typed onboarding source handoff

Isolated change: extended the onboarding source flow with a typed result carrying
the resolved project binding and the exact persisted raw-source artifacts.

Reason: the worker-compatible `process()` boundary intentionally returns no data,
but the onboarding knowledge graph needs the durable `project_id` without a
second project-resolution call. The public `ingest()` boundary now supplies that
handoff while `process()` remains compatible with the existing worker protocol.

Skill guidance:

- `tdd`
- Used vertical red-green cycles through the public onboarding flow and kept
  source-ingestion doubles at external source/storage boundaries.

TDD evidence:

- Red/green 1: mixed Slack text and URL onboarding returns the project binding and
  persisted artifacts in ingestion order.
- Red/green 2: an ingestion adapter that substitutes either project or source
  identity fails closed instead of producing a trusted graph handoff.
- Refactor: retained `process(job) -> None` for worker compatibility and exposed
  the typed result through `ingest(job)` for graph composition.

Safety and scope:

- Artifact identity is checked against both the resolved project and requested
  source before it enters the handoff.
- Existing empty-source and source-count guards still run before project creation.
- No live source, storage, Slack call, model, cloud resource, deployment,
  credential, or external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_onboarding_source_flow.py -q` —
  `4 passed`.
- Onboarding/source-ingestion/processor/worker blast radius — `24 passed`.
- Complete explicit offline unit/integration gate — `147 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a worker-compatible, typed, project-scoped onboarding
source handoff ready for knowledge graph composition.

## 2026-09-04 — Phase 3: deterministic onboarding knowledge graph

Isolated change: composed the real onboarding source flow, durable source loader,
and reviewed knowledge workflow behind one typed application graph.

Reason: the individually verified source and knowledge stages did not yet prove
that an onboarding request could persist source material, reload verified text,
compile/review grounded knowledge, and publish a ready artifact as one workflow.

Skill guidance:

- `tdd`
- Used the real Qali ingestion, screening orchestration, source flow, loader,
  extractor, quality policy, Markdown compiler, and knowledge workflow. Test
  doubles were confined to network, scanner, storage, and specialist-model
  boundaries.

TDD evidence:

- Red/green 1: a Slack text onboarding request traverses persistence, indexing,
  durable reload, extraction, analysis, deterministic quality evaluation,
  independent review, and publication to produce ready project knowledge.
- Red/green 2: if the newly persisted source is not visible in the durable index,
  the graph fails closed before invoking the knowledge workflow.

Safety and scope:

- The graph verifies that every newly ingested source ID is present in the
  bounded analysis task and that the task remains project-scoped.
- The result retains typed source, analysis, decision, review/publication, and
  artifact evidence without exposing hidden model reasoning.
- No live source, Slack API, storage, scanner, model, cloud resource, deployment,
  credential, or external integration was used.

Commands and evidence:

- `uv run pytest tests/integration/test_onboarding_knowledge_flow.py -q` —
  `2 passed`.
- Onboarding/knowledge/source pipeline blast radius — `22 passed`.
- Complete explicit offline unit/integration gate — `149 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic onboarding-to-ready-knowledge composition
and fail-closed read-after-write source visibility.

## 2026-09-04 — Phase 3: readiness-aware onboarding progress

Isolated change: connected the typed onboarding knowledge graph to the
worker-compatible progress processor and made the final Slack stage reflect the
reviewed knowledge-readiness decision.

Reason: the progress wrapper previously reported every successful delegate call
as project-ready. Reviewed but insufficient knowledge must pause onboarding for
more information without being treated as a retryable processor failure, and a
ready message must never be emitted unless compiled knowledge was published.

Skill guidance:

- `tdd`
- Used vertical red-green cycles through the public progress processor and the
  real onboarding graph. Test doubles remained at storage, network, scanner, and
  specialist-model boundaries.

TDD evidence:

- Red/green 1: an insufficient readiness outcome now ends at
  `insufficient_knowledge` rather than the misleading `ready` Slack stage.
- Red/green 2: the actual onboarding graph now implements the worker processor
  boundary and returns its deterministic readiness decision after an initial,
  create-only knowledge publication attempt.
- Red/green 3: a ready decision without a published knowledge artifact fails
  closed before the progress wrapper can report project readiness.

Safety and scope:

- Exceptions still update Slack to `failed` and propagate to the lifecycle
  handler for bounded retry; insufficient knowledge returns normally and is not
  retried as an infrastructure failure.
- The graph's worker boundary uses GCS generation `0` for the initial onboarding
  create contract; identical task retries remain governed by the repository's
  idempotent content/hash check.
- No live Slack API, storage, source, scanner, model, cloud resource, deployment,
  credential, or external integration was used.

Commands and evidence:

- Onboarding knowledge/progress tests — `8 passed`.
- Onboarding, knowledge, Slack progress, and worker blast radius — `40 passed`.
- Complete explicit offline unit/integration gate — `152 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for readiness-aware same-thread onboarding completion and
fail-closed proof that project-ready knowledge has a published artifact.

## 2026-09-04 — Phase 3: isolated ADK Knowledge Analyst adapter

Isolated change: added the production-shaped ADK adapter that implements the
existing `KnowledgeAnalyst` compile/revise contract with structured input and
output schemas in a fresh specialist session per invocation.

Reason: the deterministic knowledge workflow previously used only a specialist
protocol and test doubles. The adapter now supplies the real ADK execution
boundary without giving the model storage/network tools or shared conversation
history.

Skill and reference guidance:

- `google-agents-cli-workflow` 1.4.2 and `google-agents-cli-adk-code` 1.4.2.
- Re-read `references/samples.md`, `references/adk-python.md`, and
  `references/adk-workflows.md`; no core recipe is specific to a single bounded
  structured specialist, so the adapter uses the documented `Agent`, `Runner`,
  typed-schema, and fresh-session primitives directly.
- Ran `agents-cli info` and verified the repository remains an enhanced Python
  ADK project with `app` as its agent directory, A2A enabled, and no deployment
  target. Inspected installed ADK 2.6 signatures for `Agent`, `Runner`,
  `Runner.run_async`, and `Gemini` before implementation.

TDD evidence:

- Red/green 1: a compile request reaches a deterministic ADK model double as one
  typed current-turn payload and returns a validated `KnowledgeCompilation`.
- Red/green 2: compile and revision invocations on the same adapter each use a
  new session; revision context is explicit in the typed request rather than
  inherited from hidden conversation history.

Safety and scope:

- The specialist has no tools or delegation, accepts only bounded
  `KnowledgeAnalysisTask` data, and must cite supplied source IDs while treating
  embedded source instructions as untrusted.
- The configured model remains `gemini-3.7-flash`; no model configuration was
  changed and no paid fallback was added.
- No live Gemini request, eval, Slack API, storage, cloud resource, deployment,
  credential, or other external integration was used.

Commands and evidence:

- Deterministic ADK adapter tests — `2 passed`.
- ADK adapter/knowledge workflow/onboarding graph blast radius — `10 passed`.
- Complete explicit offline unit/integration gate — `154 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a typed, tool-free, fresh-context ADK Knowledge Analyst
execution boundary under deterministic model-double testing.

## 2026-09-04 — Phase 3: independent ADK knowledge review

Isolated change: added the production-shaped ADK Knowledge Reviewer and factored
the common fresh-session structured-agent invocation into one reusable runtime
boundary shared with the Knowledge Analyst.

Reason: the bounded knowledge quality gate still depended on a reviewer test
double. The real reviewer must receive only the compiled knowledge, deterministic
quality decision, and cited source evidence in an independent context, with no
tools or hidden analyst conversation.

Skill and reference guidance:

- `tdd`, `google-agents-cli-workflow` 1.4.2, and
  `google-agents-cli-adk-code` 1.4.2.
- Rechecked the recipe index and ADK structured-output/session guidance. No core
  recipe targets a single read-only structured reviewer, so the implementation
  reuses the installed `Agent`, `Runner`, typed schema, and fresh-session pattern.
- Preserved the existing `gemini-3.7-flash` configuration and exact installed
  ADK interfaces already verified for the preceding analyst slice.

TDD evidence:

- Red: the public reviewer adapter and factory did not exist.
- Green: a deterministic ADK model double independently receives one typed
  `KnowledgeReviewTask` and returns a validated `KnowledgeReview`.
- Refactor: extracted `run_isolated_structured_agent` and reran the existing
  compile/revise tests to prove both specialists retain fresh-session behavior.

Safety and scope:

- The reviewer has no tools, delegation, credentials, or shared session; source
  text is explicitly treated as untrusted evidence rather than instructions.
- Deterministic grounding/readiness policy remains outside the model, and a
  rejected review must still contain bounded actionable feedback through the
  existing schema.
- No live Gemini request, eval, Slack API, storage, cloud resource, deployment,
  credential, or other external integration was used.

Commands and evidence:

- Reviewer tracer test — `1 passed`.
- Analyst/reviewer/workflow blast radius — `7 passed`.
- Complete explicit offline unit/integration gate — `155 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for an independent, typed, tool-free ADK knowledge review
boundary with shared fresh-context execution mechanics.

## 2026-09-04 — Phase 3: production-shaped ADK knowledge runtime

Isolated change: added one composition factory that installs the real isolated
ADK Knowledge Analyst and independent Knowledge Reviewer into the deterministic
knowledge workflow and its publication boundary.

Reason: both specialist adapters were individually verified but application
composition could still accidentally substitute a test double, share a model
context, or bypass the deterministic quality and publication gate. The factory
now makes the intended runtime graph explicit.

Skill and reference guidance:

- `tdd`, `google-agents-cli-workflow` 1.4.2, and
  `google-agents-cli-adk-code` 1.4.2.
- Rechecked the ADK recipe index, structured-output guidance, and installed
  runtime contracts. No additional core recipe applies to this narrow factory.

TDD evidence:

- Red: no public production composition existed for the ADK analyst, ADK
  reviewer, deterministic quality policy, and knowledge repository.
- Green: separate deterministic ADK model doubles compile and independently
  approve grounded knowledge, after which the real workflow publishes exactly
  one artifact with its expected generation precondition.

Safety and scope:

- Analyst and reviewer agents remain distinct, tool-free, and fresh-session;
  deterministic grounding/readiness and publication stay outside both models.
- The existing `gemini-3.7-flash` model selection is preserved with no paid
  fallback.
- No live Gemini request, eval, Slack API, storage, cloud resource, deployment,
  credential, or other external integration was used.

Commands and evidence:

- ADK runtime tracer test — `1 passed`.
- Knowledge runtime/agent/workflow/onboarding blast radius — `12 passed`.
- Complete explicit offline unit/integration gate — `156 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for explicit production-shaped composition from isolated
ADK knowledge specialists through deterministic review and artifact publication.

## 2026-09-04 — Phase 3: onboarding worker composition root

Isolated change: added one worker application factory that composes the durable
job lifecycle, same-thread Slack progress, source-to-knowledge onboarding graph,
isolated ADK Knowledge Analyst and Reviewer, deterministic quality gate, and
authenticated Cloud Tasks HTTP boundary.

Reason: the verified services still had to be assembled manually, so a deployed
worker could omit lifecycle, progress, review, or publication safeguards. The
composition root now exposes one production-shaped application boundary while
keeping external integrations injectable and testable.

Skill and reference guidance:

- `tdd`, `google-agents-cli-workflow` 1.4.2, and
  `google-agents-cli-adk-code` 1.4.2.
- Studied the `ambient-expense-agent` event-driven recipe. Reused its in-process
  ASGI integration-test pattern and kept durable lifecycle state outside ADK's
  in-memory sessions; Qali retains its existing authenticated Cloud Tasks seam.

TDD evidence:

- Red: no public worker factory could compose the already verified onboarding
  and knowledge components behind `/internal/jobs`.
- Green: an HTTP Cloud Tasks request now claims the durable job, creates and
  updates one originating-thread progress message, compiles and independently
  reviews grounded knowledge with separate deterministic ADK model doubles,
  publishes the artifact, and completes the job.

Safety and scope:

- The worker keeps queue-name/task-name validation, bounded execution, retry
  lifecycle, project serialization, deterministic readiness, and publication
  preconditions in the existing non-model services.
- Runtime composition contains no embedded mock implementation; test doubles
  remain in the integration test and are injected only at external boundaries.
- No live Gemini request, Slack API, storage, cloud resource, deployment,
  credential, or other external integration was used.

Commands and evidence:

- Worker runtime HTTP tracer test — `1 passed`.
- Worker/onboarding/knowledge blast radius — `23 passed`.
- Complete explicit offline unit/integration gate — `157 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a single production-shaped worker application boundary
covering queued onboarding through reviewed durable knowledge and final progress.

## 2026-09-04 — Phase 3: deterministic instruction-threat screening

Isolated change: added a project-agnostic deterministic scanner for instruction
and prompt-injection threats in onboarding sources, using the same bounded text
extraction rules for text, Markdown, HTML, and PDF inputs.

Reason: source screening already enforced a typed fail-closed two-stage gate but
the instruction stage had no production implementation. Untrusted project
sources must be classified before persistence and must never become agent
instructions.

Skill guidance:

- `tdd` with vertical red-green tracer cases through the scanner and complete
  screening service public interfaces.
- This slice contains no new ADK agent or external service integration, so no
  additional ADK recipe was required.

TDD evidence:

- Red/green: a source that overrides prior instructions and requests credentials
  is classified as `prompt_injection` with a stable scanner identity.
- Red/green: bounded PDF text extraction is reused so binary PDF sources are
  screened semantically instead of failing UTF-8 decoding.
- Red/green: generic policy bypass, system-prompt extraction, credential
  exfiltration, and instruction-substitution attempts are rejected.
- Guard: ordinary product documentation remains clean, while malformed
  documents surface only a redacted fail-closed instruction-stage result.

Safety and scope:

- Detection is deterministic and contains no model, network, credential,
  project, feature, or target-specific behavior.
- Text parsing retains existing byte, output, PDF page, and PDF stream bounds.
- Malware scanning remains an explicit separate boundary; no vendor or cloud
  service was selected, provisioned, or called in this slice.
- No live Gemini request, Slack API, storage, cloud resource, deployment,
  credential, or other external integration was used.

Commands and evidence:

- Instruction scanner tracer suite — `7 passed`.
- Scanner/screening/extraction blast radius — `13 passed`.
- Complete explicit offline unit/integration gate — `164 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded, deterministic, fail-closed instruction-threat
screening across every source content type accepted by onboarding.

## 2026-09-04 — Phase 3: bounded onboarding source runtime

Isolated change: added a production-shaped source runtime factory that composes
approved-origin URL policy, DNS/IP revalidation, address-bound HTTPS transport,
malware screening, deterministic instruction screening, raw persistence,
metadata indexing, and the bounded onboarding source flow.

Reason: the individual source safeguards were verified but not yet installed as
one mandatory runtime path. Explicit composition prevents a worker entry point
from accidentally omitting redirect revalidation or instruction screening.

Skill guidance:

- `tdd` with vertical integration tests through the public onboarding source
  flow and only resolver, HTTP transport, malware, and storage boundary doubles.
- This deterministic composition slice adds no ADK agent or external service,
  so no additional ADK recipe was required.

TDD evidence:

- Red: no public factory assembled the approved-origin fetcher, both screening
  stages, durable source service, and onboarding flow.
- Green: an approved public HTTPS source is fetched with its pinned resolved
  address and byte budget, receives both scanner verdicts, and is persisted and
  indexed with their stable scanner identities.
- Guard: prompt-injection content is rejected after malware screening and before
  either raw object persistence or metadata indexing.

Safety and scope:

- Runtime settings bound approved origins, bytes, redirects, transport timeout,
  and source count; production defaults use the system resolver and the
  address-bound `aiohttp` transport.
- Malware scanning is a required injected boundary, so production composition
  cannot silently replace it with an allow-all implementation. Test doubles
  remain confined to integration tests.
- No live network request, scanner vendor, Gemini request, Slack API, storage,
  cloud resource, deployment, credential, or other integration was used.

Commands and evidence:

- Source runtime tracer suite — `2 passed`.
- Source runtime/fetch/screen/ingestion blast radius — `23 passed`.
- Complete explicit offline unit/integration gate — `166 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for an explicitly wired, bounded, fail-closed onboarding
source path with mandatory malware and instruction screening stages.

## 2026-09-04 — Phase 3: local ClamAV malware adapter

Isolated change: added a production-shaped ClamAV malware scanner adapter for
the required malware boundary in onboarding source screening.

Reason: the source runtime correctly requires a malware scanner but only test
doubles existed. A local ClamAV process provides a free, private scanning option
without sending project content to another API or adding a paid service.

Skill guidance:

- `tdd` with vertical behavior tests at the scanner's public typed-verdict
  boundary and a process-runner double only at the external executable seam.
- This deterministic adapter adds no ADK agent or model behavior, so no
  additional ADK recipe was required.

TDD evidence:

- Red/green: ClamAV exit code `0` returns a clean malware-stage verdict with the
  explicitly configured scanner/signature identity.
- Red/green: exit code `1` returns the typed `malware` threat.
- Guard: every other exit code and arbitrary runner failure becomes the same
  redacted unavailable error without source URL, bytes, or process output.

Safety and scope:

- The subprocess uses an argument vector without a shell, streams bytes over
  stdin, discards stdout/stderr, applies a bounded timeout, and kills/reaps the
  child on timeout or cancellation.
- Scanner identity is required configuration so deployment must pin the ClamAV
  engine/signature set rather than silently recording an unversioned default.
- This slice does not install ClamAV or update virus definitions. Container
  packaging, signature-refresh policy, and deployment remain separate reviewed
  work and require the normal infrastructure/deployment approval gate.
- No live scanner, network request, Gemini request, Slack API, storage, cloud
  resource, deployment, credential, or other external integration was used.

Commands and evidence:

- ClamAV adapter tracer suite — `4 passed`.
- Malware/screening/source-runtime blast radius — `10 passed`.
- Complete explicit offline unit/integration gate — `170 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a no-shell, bounded, redacted local malware-scanning
adapter ready for later pinned worker-image integration.

## 2026-09-04 — Phase 3: complete onboarding runtime composition

Isolated change: added the production-shaped onboarding runtime factory that
connects the authenticated worker boundary to bounded source acquisition,
mandatory ClamAV and deterministic instruction screening, durable source
storage and indexing, source loading, the independent ADK knowledge workflow,
Slack progress, and job lifecycle handling.

Reason: every component had been independently verified, but callers still had
to assemble the graph themselves. A single composition root makes the guarded
path the default and prevents production entry points from accidentally
omitting source screening or knowledge review.

Skill guidance:

- `tdd` with one vertical ASGI test through the public worker HTTP endpoint;
  doubles are limited to DNS, HTTP, ClamAV, persistence, Slack, and model
  boundaries.
- The existing ADK analyst and reviewer adapters are reused unchanged, with
  deterministic structured model doubles for the offline test.

TDD evidence:

- Red: importing the public runtime factory failed with
  `ModuleNotFoundError: No module named 'app.onboarding_runtime'`.
- Green: one authenticated task request traverses the complete source and
  knowledge graph, publishes a grounded artifact, reports `ready`, and
  completes the job.
- Guard: the persisted artifact records both the explicitly pinned ClamAV
  engine/signature identity and the deterministic instruction scanner identity.

Safety and scope:

- Runtime settings keep worker ingress, source bounds, ClamAV identity, and job
  execution limits explicit and immutable.
- The real system resolver, address-bound HTTPS transport, local ClamAV
  subprocess, and configured ADK models remain production defaults; dependency
  injection is exposed only for their external boundaries and repositories.
- No live scanner, network request, Gemini request, Slack API, storage, cloud
  resource, deployment, credential, or other external integration was used.

Commands and evidence:

- Complete runtime tracer suite — `1 passed`.
- Runtime/source/knowledge blast radius — `18 passed`.
- Complete explicit offline unit/integration gate — `171 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for one explicit, mock-safe onboarding composition root
from authenticated task delivery through ready-state publication.

## 2026-09-04 — Phase 3: typed Slack file references

Isolated change: signed onboarding events now carry bounded MD, TXT, and PDF
file references into the durable onboarding job without retaining Slack download
URLs.

Reason: file uploads are an approved onboarding source, but the ingress model
previously discarded all file metadata. This first tracer preserves only the
minimum trusted reference needed for a later authenticated Slack download
adapter.

Skill guidance:

- `tdd` with a signed Slack HTTP event as the public boundary and in-memory job
  and task adapters as test-only service doubles.

TDD evidence:

- Red: the signed-file test failed because `SlackFileReference` did not exist.
- Green: a valid Markdown attachment is represented in the dispatched durable
  job by file ID, name, media type, and size.
- Guard: accepted media types are restricted to MD/TXT/PDF, files are limited
  to 5 MB each and 10 per event, and an event-supplied download URL is absent
  from serialized job data.

Safety and scope:

- This slice does not download file content or use a Slack token. A later
  adapter must resolve the stored file ID through authenticated Slack APIs and
  pass bytes through the existing malware and instruction screening boundary.
- Existing text-only jobs remain backward-compatible through an empty default
  file tuple.
- No live Slack API, network request, storage, model, secret, cloud resource,
  or deployment was used.

Commands and evidence:

- Signed file-reference tracer — `1 passed`.
- Slack ingress/task/job/source-flow blast radius — `35 passed`.
- Complete explicit offline unit/integration gate — `172 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for bounded, URL-free Slack upload references at the signed
ingress boundary.

## 2026-09-04 — Phase 3: bounded Slack file retrieval boundary

Isolated change: added a bounded file fetcher between signed Slack attachment
references and the existing source-screening input type.

Reason: workers need file bytes for onboarding, but durable jobs intentionally
contain no private Slack download URL. The new boundary resolves only the file
ID through an authenticated client and reconciles the returned metadata and
content before creating a source.

Skill guidance:

- `tdd` with vertical behavior tests at the public fetcher boundary and a
  service double only for the external authenticated Slack client.

TDD evidence:

- Red/green: no file-fetcher module existed; a matching file now becomes a
  typed source whose URI contains only a SHA-256 reference to the Slack file ID.
- Red/green: changed Slack-side metadata now raises one redacted integrity error
  before content can enter source screening.
- Guard: the signed event size becomes the download byte ceiling, and file ID,
  name, media type, declared size, and actual byte length must all agree.

Safety and scope:

- The adapter contract is explicitly authenticated; its production Slack SDK
  and HTTP implementation remains a separate reviewed slice.
- The synthetic source URI contains neither the original file ID nor a private
  Slack download URL.
- No live Slack API, network request, storage, scanner, model, secret, cloud
  resource, or deployment was used.

Commands and evidence:

- Slack file retrieval tracer suite — `2 passed`.
- Slack-file/ingress/fetch/screen/ingestion blast radius — `30 passed`.
- Complete explicit offline unit/integration gate — `174 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for fail-closed, bounded reconciliation of authenticated
Slack file bytes before source screening.

## 2026-09-04 — Phase 3: authenticated Slack file client

Isolated change: added the production Slack metadata/download client behind the
bounded file-fetcher contract.

Reason: durable jobs intentionally retain only a Slack file ID. The worker now
has a production-shaped adapter that resolves current metadata with
`files_info`, validates the returned private URL, and downloads bytes with the
bot token without exposing that token to downstream source processing.

Skill and API guidance:

- `tdd` with the metadata API and HTTPS transport treated as external
  boundaries.
- Inspected the installed Slack SDK signature for
  `AsyncWebClient.files_info(*, file=...)` before implementing the adapter.

TDD evidence:

- Red/green: no client module existed; valid metadata now produces the bounded
  payload expected by the file fetcher and sends bearer authorization only to
  the download transport.
- Red/green: raw Slack SDK errors previously escaped; API and transport
  failures now become one redacted `SlackFileUnavailable` error while task
  cancellation remains intact.
- Review red/green: malformed response metadata previously escaped as a
  field-level validation error; payload validation now uses the same redacted
  unavailable error.
- Guard: the production transport rejects non-Slack origins before any request.

Safety and scope:

- Tokens use Pydantic `SecretStr`; the transport accepts only HTTPS on
  `files.slack.com` port 443 under `/files-pri/`, refuses redirects, cookies,
  environment proxies, and compressed transfer encoding, and streams no more
  than the caller's byte ceiling.
- The Slack event's file ID, not an event-supplied URL, selects the resource.
- No live Slack API, real token, external network request, storage, scanner,
  model, cloud resource, or deployment was used.

Commands and evidence:

- Slack file client tracer/guard suite — `4 passed`.
- Slack client/fetcher/ingress/screen/ingestion blast radius — `28 passed`.
- Complete explicit offline unit/integration gate — `178 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a bounded, redacted, origin-restricted production
Slack file client ready for source-flow composition.

## 2026-09-05 — Phase 3: screened Slack file source flow

Isolated change: wired approved Slack file references and fetched bytes through
the existing onboarding source runtime, mandatory screening service, raw
repository, and source index.

Reason: the signed ingress, authenticated client, and bounded fetcher were
verified independently, but uploaded files did not yet participate in the
onboarding source graph.

Skill guidance:

- `tdd` with one file-only onboarding job through the public source runtime;
  only the authenticated Slack client and persistence boundaries use test
  doubles.

TDD evidence:

- Red: the source-runtime factory rejected the `file_fetcher` boundary because
  no file handoff existed.
- Green: a Markdown Slack file receives a deterministic event-scoped source ID,
  both scanner verdicts, raw persistence, and source indexing.
- Guard: the stored source URI is the fetcher's hashed synthetic URI and does
  not contain the Slack file ID.

Safety and scope:

- File count participates in the existing global onboarding source limit.
- File bytes use the same ClamAV and deterministic instruction screening path
  as Slack text and approved HTTPS sources before any durable write.
- Text- and URL-only callers remain backward-compatible through an optional
  file-fetcher boundary; production composition is a separate reviewed slice.
- No live Slack API, token, network request, storage, scanner, model, cloud
  resource, or deployment was used.

Commands and evidence:

- File-only source-runtime tracer — `1 passed`.
- Source runtime/flow/ingestion/extraction blast radius — `16 passed`.
- Complete explicit offline unit/integration gate — `179 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for mandatory screening and durable ingestion of Slack file
sources inside the onboarding graph.

## 2026-09-05 — Phase 3: Slack file runtime composition

Isolated change: installed the authenticated Slack file client and bounded file
fetcher into the complete onboarding worker composition root.

Reason: file references and source ingestion were implemented, but the
production worker graph still omitted the file-fetch boundary. Runtime callers
could therefore construct a worker that accepted files at ingress but failed
when processing them.

Skill guidance:

- `tdd` by expanding the public ASGI onboarding tracer to carry both an
  approved URL and a Slack file through the complete worker graph.
- Test doubles remain limited to external DNS, HTTP, Slack, ClamAV, storage,
  Slack progress, and model boundaries.

TDD evidence:

- Red: immutable onboarding runtime settings rejected Slack file configuration.
- Green: the runtime now creates the production Slack API client by default,
  wraps it in the bounded fetcher, and passes it into source ingestion.
- Guard: the full tracer proves both URL and file artifacts record ClamAV and
  deterministic instruction scanner identities before grounded knowledge is
  published and the job becomes ready.

Safety and scope:

- Slack file settings, including the redacted token type and timeout, are
  required production configuration rather than an implicit environment read.
- Tests inject an authenticated-client double; production composition contains
  no in-memory or allow-all fallback.
- No live Slack API, token, network request, storage, scanner, model, cloud
  resource, or deployment was used.

Commands and evidence:

- Full onboarding URL-plus-file ASGI tracer — `1 passed`.
- Runtime/source/file/knowledge composition blast radius — `15 passed`.
- Complete explicit offline unit/integration gate — `179 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for production-composable Slack uploads across the complete
onboarding worker path.

## 2026-09-05 — Phase 3: unsafe Slack file acceptance gate

Isolated change: added a full-worker acceptance tracer proving that instruction-
carrying Slack file content is rejected before any durable artifact is written.

Reason: component screening tests existed, but the PR 1 acceptance gate also
requires evidence that the complete composed onboarding path fails closed for an
unsafe uploaded file.

Skill guidance:

- `tdd` with the authenticated Slack client, ClamAV process, persistence, Slack
  progress, and model treated as external boundaries.

TDD evidence:

- Red: the first tracer used a content-specific ClamAV double and reached the
  unavailable-scanner path instead of the intended instruction-policy decision.
- Green: after allowing the external scanner boundary to report the unsafe sample
  malware-clean, the deterministic instruction scanner rejects it as prompt
  injection through the public worker HTTP route.
- Guard: the tracer verifies zero raw-source records, no knowledge publication,
  and a failed same-thread progress state after rejection.

Safety and scope:

- This slice adds acceptance evidence only; it does not weaken screening or alter
  production behavior.
- The unsafe sample is synthetic and contains no secret, private URL, or live
  integration data.
- No live Slack API, token, network request, storage, scanner, model, cloud
  resource, or deployment was used.

Commands and evidence:

- Unsafe-file full-worker tracer — `1 passed`.
- Complete onboarding runtime tracer suite — `2 passed`.
- Complete explicit offline unit/integration gate — `180 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for fail-closed prompt-injection rejection of Slack file
content before durable onboarding writes.

## 2026-09-05 — Phase 3: live onboarding worker environment composition

Isolated change: added one fail-closed environment entry point that composes the
complete onboarding worker with its Firestore, GCS, Slack, source-policy, ClamAV,
model-mode, queue, and execution-budget configuration.

Reason: all production adapters and the complete worker graph existed, but a
deployment entry point still required manual Python wiring and could omit a
durability, screening, or budget boundary.

Skill guidance:

- `tdd` with production client constructors replaced only at the Firestore, GCS,
  and Slack system boundaries.

TDD evidence:

- Red: no public environment factory existed for the onboarding worker.
- Green: explicit live configuration now produces one FastAPI worker with the
  durable adapter settings and redacted Slack file secret attached to its runtime
  settings.
- Red: a missing late Firestore setting allowed the job adapter constructor to run
  before startup validation completed.
- Green: all 25 required values are parsed and model-validated before any external
  adapter is created.
- Red: an unsafe HTTP allowed origin reached external adapter construction before
  the source network policy rejected it.
- Green: every configured allowed origin is now validated by the source URL policy
  before any external adapter is created.
- Guard: the worker rejects non-live mode, paid Vertex AI mode, absent free-tier
  model credentials, and every missing storage, Slack, screening, or budget value.

Safety and scope:

- The factory requires `GOOGLE_GENAI_USE_VERTEXAI=false`; there is no automatic
  paid-model fallback.
- The Slack token is held by `SecretStr` in runtime settings and is injected only
  into the Slack progress and authenticated file clients.
- `.env.example` contains placeholders only. No live credential, API request,
  cloud resource, scanner process, model call, or deployment was used.

Commands and evidence:

- Environment composition and fail-closed suite — `28 passed`.
- Worker/storage/Slack composition blast radius — `71 passed`.
- Complete explicit offline unit/integration gate — `208 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for explicit, free-tier-only production worker composition
that validates all deployment configuration before client construction.

## 2026-09-07 — Phase 3: grounded Product Alignment specialist

Isolated change: added the first generic feature-testing specialist contract and
ADK runtime boundary. The Product Alignment Analyst receives one natural-language
feature request plus compiled project knowledge and returns a typed product intent.

Reason: onboarding can now produce durable knowledge, but the feature-testing
graph still lacked a least-privilege handoff that defines user value, expected
behavior, prerequisites, included/excluded scope, and unresolved ambiguity before
strategy or browser work begins.

Skill and reference guidance:

- `tdd` — one public behavior per red-green cycle, with the model kept behind a
  test-only `BaseLlm` system-boundary double.
- `google-agents-cli-workflow` and `google-agents-cli-adk-code` version `1.4.2` —
  preserved the scaffolded project and existing model ID, used a structured
  no-history specialist, and consulted `references/samples.md`,
  `references/adk-python.md`, and `references/adk-workflows.md`.
- No core recipe matches this stateless structured specialist contract. The
  existing isolated ADK runtime is reused instead of adding a new orchestration
  or persistence mechanism.

TDD evidence:

- Red: no Product Alignment contract or public specialist runtime existed.
- Green: a fresh ADK context receives only the typed project ID, feature request,
  and compiled knowledge, then returns a typed `ProductIntent`.
- Red/green: invented source IDs in expected behavior, user value, or included
  scope initially crossed the model boundary; deterministic grounding validation
  now rejects each before downstream use.
- Red/green: a ready result could initially hide ambiguity or omit expected
  behavior; schema validation now requires clarification reasons and at least one
  grounded expected behavior for ready intents.

Safety and scope:

- The specialist has no tools, transfers, browser, storage, credential, shell, or
  network access and receives no source bodies beyond approved compiled knowledge.
- Request and knowledge text are explicitly treated as untrusted data. Invalid or
  cross-project structured output fails closed as `ProductAlignmentOutputError`.
- Tests use synthetic profile-editing data and a deterministic model double. No
  live model, credential, integration, cloud resource, or deployment was used.

Commands and evidence:

- Product Alignment unit/integration suite — `9 passed`.
- Product/knowledge specialist blast radius — `13 passed`.
- Complete explicit offline unit/integration gate — `217 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a project-agnostic, typed Product Alignment boundary with
deterministic citation and ambiguity guards. Behavioral model evaluation remains
part of the later approved free-tier evaluation gate.

## 2026-09-07 — Phase 3: independent QA Strategy and Risk specialists

Isolated bundle: added the two independent planning inputs that follow an approved
`ProductIntent`: a QA Strategist and a Risk Analyst. Both use typed, tool-free ADK
contexts; neither sees the other specialist's output.

Reason: the generic feature-testing graph requires strategy/risk fan-out before a
Test Designer can synthesize scenarios. Bundling the pair establishes their shared
scope boundary and independence in one review cycle without yet adding synthesis
or browser execution.

Skill and reference guidance:

- `tdd` — advanced one observable contract at a time through red-green cycles and
  replaced only the external model boundary with deterministic `BaseLlm` doubles.
- `google-agents-cli-workflow` and `google-agents-cli-adk-code` version `1.4.2` —
  preserved the scaffold, existing model ID, structured-output pattern, and fresh
  session isolation after consulting `references/samples.md`,
  `references/adk-python.md`, and `references/adk-workflows.md`.
- No core recipe matches these stateless specialist contracts. The existing
  isolated runtime is reused; graph fan-out remains a later deterministic service
  slice once the Test Designer contract exists.

TDD evidence:

- Red/green: no typed QA strategy boundary existed; the new specialist receives
  only approved product intent and returns mission, assumptions, stopping
  conditions, and explicit decisions for all nine required coverage concerns.
- Red/green: incomplete or duplicated coverage could cross the model boundary;
  `TestStrategy` now requires each concern exactly once, including explicit
  not-applicable rationales.
- Red/green: no independent Risk Analyst existed; it now receives the same product
  intent without strategy context and covers product, state, data, environment,
  concurrency, and usability risk areas.
- Red/green: incomplete areas, empty identified areas, hidden risks under
  not-applicable decisions, mismatched risk categories, and duplicate stable risk
  IDs now fail schema validation.
- Guard: both outputs must match the approved project and feature, and neither task
  accepts a product intent that still needs clarification.

Safety and scope:

- Both agents have no tools, transfers, browser, storage, credential, shell, or
  network access. Request-derived text remains untrusted data, not instructions.
- The pair defines planning inputs only. It does not run fan-out, synthesize test
  scenarios, assign pass/fail, call a browser, persist artifacts, or change live
  worker behavior.
- Tests use synthetic profile-editing inputs and deterministic model doubles. No
  live model, credential, integration, cloud resource, or deployment was used.

Commands and evidence:

- QA Strategy/Risk unit and integration suite — `11 passed`.
- Product/knowledge/planning specialist blast radius — `24 passed`.
- Complete explicit offline unit/integration gate — `228 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for independent, project-agnostic strategy and risk specialist
boundaries with deterministic completeness, scope, and consistency guards.

## 2026-09-07 — Phase 3: grounded Test Designer and plan quality gate

Isolated bundle: added the Test Designer synthesis boundary, deterministic plan
validation, an independent Quality Reviewer, and a workflow that permits at most
one plan revision before returning an explicit escalated result.

Reason: the generic feature-testing graph needs a reviewed, executable plan before
browser execution can begin. This slice joins the already approved product intent,
strategy, and independent risk assessment without granting either model browser or
mutation capabilities.

Skill and reference guidance:

- `tdd` — advanced oracle, traceability, coverage, identity, isolation, and bounded
  review behavior through red-green cycles with deterministic model doubles.
- `google-agents-cli-workflow` and `google-agents-cli-adk-code` version `1.4.2` —
  preserved the scaffold, existing model ID, typed structured-output convention,
  and fresh invocation contexts after consulting `references/samples.md`,
  `references/adk-python.md`, and `references/adk-workflows.md`.
- The established isolated ADK runtime and one-revision workflow pattern are reused;
  no new orchestration framework or persistence mechanism was introduced.

TDD evidence:

- Red/green: absence oracles could carry contradictory expected values and value
  oracles could omit them; operator/value consistency is now schema-enforced.
- Red/green: scenarios accepted arbitrary coverage labels; coverage is now typed to
  the nine strategy concerns.
- Red/green: unsupported product/risk trace references, incomplete or extra strategy
  coverage, cross-feature plans, duplicate scenario IDs, and duplicate oracle IDs
  now fail closed before downstream use.
- Green: design and revision calls each use a fresh isolated ADK context containing
  only the typed design task and explicit revision material.
- Red/green: the independent reviewer has a typed approve/reject contract, no tools,
  and no transfer capability. The deterministic workflow allows one revision and
  returns `escalated` after a second rejection instead of silently continuing.

Safety and scope:

- Neither specialist can browse, mutate product state, access credentials, storage,
  shell, or arbitrary network tools. Supplied product text remains untrusted data.
- The LLM proposes scenarios but cannot assign pass/fail; deterministic validation
  remains the trusted boundary for scope, traceability, coverage, and identities.
- Tests use synthetic profile-editing data and `BaseLlm`/protocol doubles. No live
  model, credential, integration, cloud resource, browser, or deployment was used.

Commands and evidence:

- Test Designer and plan-review unit/integration suite — `17 passed`.
- Complete explicit offline unit/integration gate — `245 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for the reviewed-plan boundary required before the restricted
Browser Executor slice.

## 2026-09-07 — Phase 3: restricted Browser Executor boundary

Isolated bundle: added harness-owned oracle evaluation, a deny-by-default browser
policy, a restricted browser facade, and the accessibility-first ADK Browser
Executor for one approved scenario.

Reason: a reviewed plan must cross a narrow, auditable boundary before any browser
work occurs. The model may explore with approved actions, while deterministic code
retains control of origins, credentials, budgets, observations, and verdicts.

Skill and reference guidance:

- `tdd` — advanced oracle comparison, policy denial, redirect handling, credential
  isolation, lifecycle, step budget, tool execution, and false-pass prevention in
  red-green slices using only test doubles at external boundaries.
- `agentic-browser-testing` — kept interaction accessibility-tree-first, required
  positive and forbidden-state observations, bounded steps, and externalized the
  pass/fail oracle from the model.
- `google-agents-cli-workflow` and `google-agents-cli-adk-code` version `1.4.2` —
  preserved the scaffold, pinned model ID, fresh invocation context, typed tools,
  and temperature-zero execution convention.

TDD evidence:

- Red/green: deterministic oracle actuals must match every approved oracle exactly
  once; missing, duplicate, mismatched, or type-incompatible values fail closed.
- Red/green: navigation and redirects are restricted to canonical configured HTTPS
  origins, non-navigation requires an approved current page, and consequential
  clicks require an explicit project allowlist entry.
- Red/green: password-like text entry is rejected. The model receives approved
  credential names only; the facade resolves stored Secret Manager references and
  passes values solely to the private backend without returning them.
- Red/green: the facade owns isolated start/close lifecycle, records typed oracle
  actuals, and enforces the project/scenario step budget and timeout.
- Red/green: the Browser Executor receives only the scenario and redacted policy,
  exposes only policy-approved tools, cannot claim unrecorded observations, and has
  no pass/fail field. A deliberately wrong actual produces a deterministic failed
  check even when the agent reports execution complete.

Safety and scope:

- No raw MCP tool, shell, filesystem, unrestricted network, pixel action, or vision
  capability is exposed. Page and accessibility text are treated as untrusted data.
- The backend remains a protocol in this slice and tests use an in-memory MCP-boundary
  double; no browser process, live credential, target integration, cloud resource,
  or deployment was used.
- Safe credential references remain persistable in policy state, while the explicit
  model-facing policy view omits Secret Manager resource paths and all secret values.

Commands and evidence:

- Browser policy/facade/executor/oracle suite — `15 passed`.
- Complete explicit offline unit/integration gate — `260 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for the restricted Browser Executor contract and deterministic
verdict boundary. A production Playwright MCP process adapter and real-browser
qualification remain later approved integration work.

## 2026-09-08 — Phase 3: reviewed failure investigation

Isolated bundle: added stable failure fingerprints, a one-reproduction Failure
Investigator workflow, an independent failure Quality Reviewer, and typed finding
records for reproducible failures.

Reason: deterministic browser failures must be reproduced once in a fresh context,
classified without changing their approved expected behavior, and independently
reviewed before Qali presents them as findings.

Skill and reference guidance:

- `tdd` — advanced fingerprint stability, non-reproduction, reproducible finding,
  bounded revision, fresh-context, and fail-closed output behavior through explicit
  red-green cycles and boundary-only test doubles.
- `bug-reproduction` — required reproduction before classification, distinguished a
  passing rerun from a confirmed defect, and captured a complete evidence contract.
- `ai-bug-triage` — kept normalization and fingerprinting deterministic while using
  the LLM only for typed explanation and classification.
- `google-agents-cli-workflow` and `google-agents-cli-adk-code` version `1.4.2` —
  reused isolated structured ADK invocations and the existing pinned model without
  introducing another orchestration framework.

TDD evidence:

- Red/green: fingerprints changed with timestamps, process IDs, ports, request IDs,
  and source line numbers; normalization now removes runtime noise before hashing
  sorted project, feature, scenario, oracle, expected, and actual anchors.
- Guard: different exception types and different failed properties retain distinct
  fingerprints, while evidence storage locations never affect finding identity.
- Red/green: a failed observation had no bounded reproduction path; the workflow now
  requests exactly one rerun and rejects reuse of the initial context ID.
- Red/green: a passing rerun could be overclaimed as a defect; it now returns a
  deterministic `flaky_inconclusive` result without invoking either model or creating
  a finding.
- Red/green: reproduced failures now enter a typed classification and independent
  review gate. One revision is permitted; a second rejection returns `escalated` and
  no finding.
- Red/green: a product-defect claim with different initial and reproduction
  fingerprints fails closed, as do inconsistent oracle verdicts, missing failure
  evidence, forged fingerprints, or unsupported failed-oracle IDs.

Safety and scope:

- Failure evidence requires trace, accessibility snapshot, console, network, and
  screenshot references for every failed attempt. Finding IDs are stable hashes and
  findings retain only typed failed checks, approved trace references, and evidence
  references.
- The investigator and reviewer are tool-free, isolated ADK agents. Their payloads
  omit browser target policy and Secret Manager references, and supplied observations
  remain untrusted data rather than instructions.
- Tests use synthetic profile-editing observations and deterministic model/protocol
  doubles. No browser process, live model, credential, external integration, cloud
  resource, or deployment was used.

Commands and evidence:

- Failure fingerprint/contract/workflow/agent suite — `14 passed`.
- Complete explicit offline unit/integration gate — `274 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for the reproducible-failure classification boundary. Artifact
persistence, Slack summaries/follow-ups, production browser evidence capture, and
real-browser qualification remain later isolated slices.

## 2026-09-08 — Phase 3: immutable run and finding artifacts

Isolated bundle: compiled complete typed feature-run state into the planned request,
plan, result, report, and issue documents, then added create-only GCS persistence and
an equivalent in-memory mock repository.

Reason: every feature run needs durable operational JSON and human-readable evidence,
and confirmed findings need an accurate follow-up artifact without rerunning the
browser or allowing retries to overwrite prior evidence.

Skill and method:

- `tdd` — advanced one failed-run compiler, one successful-run compiler, path safety,
  immutable mock persistence, and create-only GCS retry behavior through red-green
  slices. Only the storage client and clock boundaries are doubled.
- The committed Qali plan supplied the canonical object layout and the requirements
  for honest scenario/check counts, concise happy results, stable finding IDs, and
  grounded steps/expected/actual/evidence follow-up.

TDD evidence:

- Red/green: no feature-run artifact contract existed; a complete run now emits exactly
  `request.md`, `plan.json`, `result.json`, and `report.md` below its immutable run
  prefix, plus one issue Markdown document per confirmed finding.
- Red/green: successful output could become verbose; the happy report is one concise
  sentence with honest scenario and check counts and emits no issue document.
- Red/green: failure details were not available without replay; issue documents now
  derive approved scenario intent, deterministic expected/actual checks, traceability,
  and all captured evidence references from the persisted typed result.
- Red/green: callers could construct incomplete or mismatched run records; the boundary
  requires one result per planned scenario and one investigation per failed scenario,
  tied to the exact initial failure.
- Red/green: forged investigation status/finding identity and artifact paths outside
  the planned project layout fail schema validation.
- Red/green: storage retries could overwrite run history; both repositories are
  create-only and idempotently reuse byte-identical content while rejecting collisions.

Safety and scope:

- Resource identifiers and object paths are constrained to the configured project/run
  layout. Content hashes are verified before persistence, and GCS writes use generation
  precondition zero with checksum verification.
- The in-memory repository mirrors immutable production semantics for the complete
  local mock experience; it does not silently relax collision handling.
- Tests use synthetic profile-editing records and in-memory storage doubles. No live
  bucket, browser, model, credential, integration, cloud resource, or deployment was
  used.

Commands and evidence:

- Run/finding artifact and failure-contract blast radius — `21 passed`.
- Complete explicit offline unit/integration gate — `281 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic immutable run/finding artifacts and offline/
production repository parity. Slack rendering, issue index/testing-log projections,
production browser evidence capture, and full feature-workflow composition remain
later isolated slices.

## 2026-09-08 — Phase 3: concise Slack feature results

Isolated slice: rendered persisted feature-run records into essentials-first Slack
results and grounded finding follow-ups, then added production and in-memory
publishers that update the existing progress message.

Reason: Qali's Slack surface must give users an honest result at a glance while
keeping detailed reproduction evidence available without exposing orchestration,
secret locations, or internal fingerprint inputs.

Skill and method:

- `tdd` — advanced success, confirmed-failure, inconclusive-failure, follow-up, and
  publisher retry behavior through focused red-green cycles.
- `qa-report-humanizer` — kept the primary result to scenario/check counts and a
  concise finding summary, with evidence-rich detail available only in follow-up.

TDD evidence:

- Red/green: no Slack result contract existed; successful runs now render one concise
  sentence with exact scenario and check counts and a visible mock-mode badge when
  applicable.
- Red/green: failed runs now lead with counts, list only reviewed findings, and report
  a non-reproduced failure as `No confirmed finding` instead of claiming a defect.
- Red/green: finding follow-up is reconstructed from persisted approved scenario
  intent, expected/actual checks, and evidence references without rerunning a browser.
- Red/green: both publishers replace the existing progress message; the mock
  publisher keys updates by message timestamp so retries cannot create duplicates.

Safety and scope:

- Slack text escapes user-derived markup and collapses whitespace. Primary results
  omit internal context IDs, fingerprint internals, and Secret Manager references.
- Tests use synthetic feature records and deterministic Slack/model protocol doubles.
  No live Slack API, browser, model, credential, external integration, cloud resource,
  or deployment was used.

Commands and evidence:

- Slack result, run-artifact, and failure-investigation blast radius — `18 passed`.
- Complete explicit offline unit/integration gate — `286 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for concise Slack feature results and persisted-evidence
follow-up. Issue index/testing-log projections, production browser evidence capture,
and full feature-workflow composition remain later isolated slices.

## 2026-09-08 — Phase 3: deterministic project projections

Isolated slice: materialized immutable feature-run audit events into chronological
`logs/testing-log.md` and current `issues/index.md` project projections.

Reason: the project-level log and issue index are mutable views, so they must be
regenerated deterministically from durable run truth instead of updated through
fragile concurrent appends.

TDD evidence:

- Red/green: no projection compiler existed; unordered run events now produce a
  stable chronological testing log with exact scenario/check counts and finding IDs.
- Red/green: confirmed findings default to open and persisted issue state can mark a
  known finding resolved without changing its immutable finding artifact.
- Red/green: projection output is independent of caller input order.
- Guard: cross-project events, duplicate run events, duplicate finding states, naive
  timestamps, and status records for unknown findings fail closed.
- Lint red/green: the type checker rejected enum-class iteration; projection section
  order now uses an explicit typed status tuple.

Safety and scope:

- Projection documents use the planned project-scoped paths and carry verified
  content hashes. User-derived text is collapsed to one line and Markdown backticks
  are escaped.
- Tests use synthetic persisted feature records only. No live storage, browser,
  model, credential, external integration, cloud resource, or deployment was used.

Commands and evidence:

- Projection and run-artifact blast radius — `8 passed`.
- Complete explicit offline unit/integration gate — `291 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for deterministic testing-log and issue-index materialization.
Production projection publication, browser evidence capture, and full feature-workflow
composition remain later isolated slices.

## 2026-09-08 — Phase 3: guarded projection publication

Isolated slice: added production GCS and in-memory repositories for publishing the
materialized testing-log and issue-index documents with explicit generation guards.

Reason: regenerated project views must support safe incremental replacement and
idempotent task retries without silently accepting stale or conflicting content.

TDD evidence:

- Red/green: no projection publication boundary existed; the in-memory mock now
  publishes and reads both project-scoped documents with production-shaped pointers.
- Red/green: guarded mock updates replace both documents under one lock, reject stale
  changed content without partial mutation, and reuse byte-identical stale retries.
- Red/green: the GCS repository writes both planned paths with caller-supplied
  generation preconditions, checksums, hashes, project metadata, and bounded timeouts.
- Red/green: GCS precondition failures reuse only byte-identical existing projections;
  different content or metadata fails closed as a generation conflict.

Safety and scope:

- Expected generations must cover exactly both projection paths and cannot be
  negative. Repository clocks must return timezone-aware values.
- Tests use deterministic clocks and versioned storage doubles. No live bucket,
  browser, model, credential, external integration, cloud resource, or deployment was
  used.

Commands and evidence:

- Projection compiler/repository and run-artifact repository blast radius — `13 passed`.
- Complete explicit offline unit/integration gate — `297 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for mock-safe, generation-guarded project projection
publication. Production browser evidence capture and full feature-workflow composition
remain later isolated slices.

## 2026-09-08 — Phase 3: approved feature-run workflow

Isolated slice: composed an approved reviewed plan through bounded scenario execution,
failure investigation, immutable run-artifact publication, and concise Slack result
publication.

Reason: the specialist boundaries were individually proven, but Qali still needed a
deterministic application workflow that preserves their gates and publishes no success
claim before durable evidence exists.

TDD evidence:

- Red/green: no approved-plan execution workflow existed; one successful scenario now
  produces a complete typed run record, four immutable artifacts, and one concise
  mock-badged Slack result.
- Red/green: a failed initial attempt is passed to the failure workflow and only its
  reviewed finding is compiled into the fifth issue artifact and Slack summary.
- Red/green: retrying the same run reuses immutable artifacts and replaces the same
  Slack progress message instead of duplicating evidence or user-facing output.
- Guard: a scenario runner cannot substitute a result for another scenario, and an
  artifact publication failure prevents a success message from being emitted.
- Guard: task construction requires an approved plan, matching project policy, and a
  browser policy that remains within every scenario's approved step budget.

Safety and scope:

- External browser/session creation, artifact storage, and Slack remain narrow injected
  boundaries. Tests use deterministic attempts and in-memory repositories/publishers.
- No live browser, model, Slack API, credential, external integration, cloud resource,
  or deployment was used.

Commands and evidence:

- Feature-run, failure, artifact, and Slack composition blast radius — `20 passed`.
- Complete explicit offline unit/integration gate — `302 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for approved-plan execution through durable evidence and Slack.
Upstream product/strategy/plan composition, production browser evidence capture, and
live qualification remain later isolated slices.

## 2026-09-08 — Phase 3: reviewed feature-planning workflow

Isolated slice: composed Product Alignment into independent QA Strategy and Risk
analysis, then joined both typed outputs at the bounded Test Design and plan-review
gate.

Reason: the planning specialists were individually proven, but Qali needed one
deterministic graph that stops on ambiguity and cannot execute an unapproved or
internally inconsistent plan.

TDD evidence:

- Red/green: no upstream feature-planning graph existed; a grounded ready intent now
  fans out to strategy and risk tasks containing only that approved intent, then
  supplies both results to Test Design.
- Red/green: an ambiguous intent returns `needs_clarification` before strategy, risk,
  or test-design work begins.
- Red/green: a second plan-review rejection remains explicitly `escalated` with its
  typed reviewer feedback instead of being treated as executable.
- Guard: product citations, strategy scope, risk scope, plan traceability/coverage,
  and final plan-review status are revalidated at composition boundaries; an
  inconsistent plan verdict fails closed.

Safety and scope:

- Strategy and Risk receive isolated typed intent tasks and neither receives the
  other's output. Test Design starts only after both validated results are available.
- Tests use deterministic specialist/workflow doubles. No live model, browser, Slack
  API, credential, external integration, cloud resource, or deployment was used.

Commands and evidence:

- Planning workflow and specialist blast radius — `16 passed`.
- Complete explicit offline unit/integration gate — `306 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for reviewed upstream feature planning. End-to-end composition
with approved feature execution, production browser evidence capture, and live
qualification remain later isolated slices.
