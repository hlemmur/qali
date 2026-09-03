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
