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

## 2026-09-08 — Phase 3: end-to-end feature request workflow

Isolated slice: composed reviewed feature planning with approved feature execution
behind one typed application workflow.

Reason: planning and execution were separately proven, but no deterministic boundary
carried an approved plan into its exact run request or prevented clarification and
escalation outcomes from reaching the browser workflow.

TDD evidence:

- Red/green: no feature-request composition module existed; approved planning now
  creates one scoped `FeatureRunTask` and returns the completed durable run result.
- Red/green: `needs_clarification` and `escalated` planning outcomes return their
  explicit status without invoking feature execution.
- Red/green: unsafe run identifiers and project/policy scope mismatches are rejected
  before either injected workflow can run.
- Guard: the workflow rejects an execution result whose project, run, feature slug,
  request, or test plan differs from the approved request.
- Architectural check: the same application workflow passes for unrelated
  `profile-editing` and `catalog-filtering` feature slugs without feature-specific
  production branches.

Safety and scope:

- Planning and execution remain narrow injected protocols; existing deterministic
  doubles and in-memory artifact/Slack publishers exercise the complete handoff.
- Mock mode is propagated into the feature run and remains visible in its Slack
  result. No live model, browser, Slack API, credential, external integration, cloud
  resource, or deployment was used.

Commands and evidence:

- Feature-request/planning/run composition blast radius — `16 passed`.
- Complete explicit offline unit/integration gate — `313 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for reviewed planning through approved feature execution.
Production browser evidence capture and live qualification remain later isolated
slices requiring their own approval and integration evidence.

## 2026-09-08 — Phase 3: isolated browser attempt runner

Isolated slice: added the deterministic bridge from one approved browser execution
task to a typed `FailureAttempt`, with fresh-context enforcement and mandatory
failure evidence export.

Reason: feature execution consumes attempts, while the browser specialist returned
only an evaluated scenario result. The missing boundary could not prove that retries
used a fresh context or that a failed result had complete evidence before failure
investigation began.

Guidance and reference:

- `tdd` and `playwright-automation` version `2.0` were used for the red/green loop
  and browser isolation/evidence design.
- The current official
  [`microsoft/playwright-mcp`](https://github.com/microsoft/playwright-mcp)
  tool surface was reviewed. This slice deliberately defines no version-sensitive
  MCP tool mapping; transport and concrete evidence export remain a separate slice.

TDD evidence:

- Red/green: no browser-attempt runner existed; a passing scenario now returns a
  typed attempt without performing failure-only evidence work.
- Red/green: a failed scenario now requires the exporter to return all five evidence
  references before a valid `FailureAttempt` can exist.
- Red/green: an exporter failure propagates and cannot produce an incomplete attempt.
- Guard: a context ID is reserved before browser execution and cannot be reused for
  a later attempt, including a reproduction after a contaminated or failed run.
- Guard: an executor cannot substitute a result for another scenario, and evidence
  export does not run for that untrusted output.

Safety and scope:

- Context creation, restricted browser execution, and evidence export remain narrow
  injected protocols. Tests use only service doubles and the existing mock-safe
  browser facade.
- No Playwright MCP process, live browser, model, Slack API, credential, external
  integration, cloud resource, or deployment was used.

Commands and evidence:

- Browser/executor/failure/run composition blast radius — `21 passed`.
- Complete explicit offline unit/integration gate — `318 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for fresh-context browser attempts with fail-closed failure
evidence requirements. Concrete Playwright MCP transport/evidence export and live
qualification remain later isolated slices.

## 2026-09-08 — Phase 3: browser run-scope propagation

Isolated slice: carried the owning feature-run ID into every restricted browser
execution task without adding that internal identifier to the browser-agent prompt.

Reason: the planned durable evidence layout is
`projects/{project_id}/runs/{run_id}/evidence/...`, but browser attempts previously
had no typed run scope. A concrete evidence exporter therefore could not derive a
safe owning path without an out-of-band lookup or an untrusted caller-supplied value.

TDD evidence:

- Red/green tracer: an approved feature run previously produced a browser task with
  no `run_id`; it now propagates the exact validated run ID into each scenario task.
- Guard: browser execution rejects unsafe run identifiers before context creation or
  browser use.
- Guard: the run ID remains harness-only metadata and is deliberately excluded from
  the minimized `BrowserExecutorRequest` sent to the model.
- Existing failure investigation retains the same browser task, so initial and
  reproduction evidence share the correct owning run scope while still using fresh
  context IDs.

Safety and scope:

- No selector, URL, feature, project fixture, credential, or model behavior was
  added. Existing test doubles remain confined to tests.
- No Playwright MCP process, live browser, model, Slack API, credential, external
  integration, cloud resource, or deployment was used.

Commands and evidence:

- Browser/run/failure scope blast radius — `19 passed`.
- Complete explicit offline unit/integration gate — `319 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for safe run-scoped browser attempts. Immutable browser evidence
export can now target the approved run path in the next isolated slice.

## 2026-09-08 — Phase 3: immutable browser failure evidence export

Isolated slice: added the deterministic exporter that turns one typed failure capture
into five immutable run artifacts and returns the complete evidence references required
by failure investigation.

Reason: failed attempts already required trace, accessibility snapshot, console/network
evidence, and screenshot references, but no implementation compiled and persisted those
assets under the owning run. The exporter now targets
`projects/{project_id}/runs/{run_id}/evidence/{context_id}/...` without relying on an
out-of-band scope lookup.

TDD evidence:

- Red/green tracer: no evidence exporter existed; a failed result now captures and
  publishes the five required assets with deterministic names and content types.
- Guard: unsafe project/run/context scope, a passing result, or a result from another
  scenario is rejected before capture or storage.
- Guard: retries with identical bytes are idempotent through the immutable repository,
  while changed content at the same evidence path raises a write conflict.
- Guard: the exporter verifies the repository returned all five expected references in
  canonical order before constructing a `FailureEvidenceBundle`.

Safety and scope:

- The capture source and artifact repository remain injected boundaries. Integration
  tests use only typed captures and the in-memory immutable repository; the existing GCS
  repository can accept the same validated evidence bundle without a live cloud call.
- Evidence payloads are schema-bounded and JSON logs are serialized deterministically.
  No credentials, signed URLs, selectors, target fixtures, or model context are added.
- No Playwright MCP process, live browser, model, Slack API, external integration, cloud
  resource, or deployment was used. A concrete Playwright capture adapter remains a
  later isolated slice.

Commands and evidence:

- Evidence/repository/attempt-runner blast radius — `13 passed`.
- Complete explicit offline unit/integration gate — `325 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for mock-safe, immutable, run-scoped browser failure evidence
export. Live Playwright capture and end-to-end SauceDemo qualification remain pending.

## 2026-09-08 — Phase 3: restricted browser context factory

Isolated slice: added the production composition boundary that creates a fresh
backend-bound `RestrictedBrowserSession` for each browser attempt.

Reason: the attempt runner required a context factory, but the repository had no
implementation that assembled the task policy, approved oracle set, credential
resolver, and one isolated browser backend without exposing those dependencies to the
browser specialist.

Guidance and reference:

- `tdd` and `playwright-automation` version `2.0` guided the red/green loop and the
  fresh-`BrowserContext` isolation boundary.
- Concrete Playwright MCP process startup and tool mapping remain outside this slice;
  the backend factory is the narrow seam for that adapter.

TDD evidence:

- Red/green tracer: no context-factory implementation existed; each creation now
  requests a distinct backend and returns a distinct restricted session scoped to the
  approved task policy and positive/forbidden oracle set.
- Guard: unsafe generated context IDs are rejected before backend creation.
- Integration proof enters the resulting session and executes only through the
  existing restricted facade, preserving its start/close lifecycle and URL policy.

Safety and scope:

- Backend creation, context-ID generation, and credential resolution are injected.
  Tests use only deterministic service doubles and make no browser or network call.
- Default context IDs use a fresh UUID-derived value; the attempt runner retains its
  independent duplicate-context rejection guard.
- No Playwright MCP process, live browser, model, Slack API, credential, external
  integration, cloud resource, or deployment was used.

Commands and evidence:

- Browser context/attempt/facade/executor blast radius — `14 passed`.
- Complete explicit offline unit/integration gate — `327 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for mock-safe restricted browser-context composition. A pinned
Playwright MCP backend remains the next isolated browser-adapter slice.

## 2026-09-08 — Phase 3: pinned Playwright MCP process specification

Isolated slice: added a deterministic, fail-closed process specification for the
reviewed Playwright MCP release without launching or installing the server.

Reason: the next browser adapter needs an exact executable contract before subprocess
lifecycle or tool mapping can be trusted. Runtime use of `@playwright/mcp@latest` or an
install-on-demand command would permit silent drift and runtime code download.

Guidance and reference:

- `tdd` and `playwright-automation` version `2.0` guided the red/green loop, fresh
  context isolation, headless Chromium choice, and evidence-output handling.
- The official
  [`microsoft/playwright-mcp`](https://github.com/microsoft/playwright-mcp) README and
  latest release were refreshed before implementation. The reviewed package is pinned
  to `@playwright/mcp@0.0.80` (`v0.0.80`, published 2026-09-01).
- Upstream documents `--allowed-origins` as not being a security boundary. Qali's
  restricted browser facade and post-navigation URL validation remain authoritative;
  the MCP flag is defense in depth only.

TDD evidence:

- Red/green tracer: no MCP process specification existed; it now produces the exact
  pinned, headless, isolated Chromium command with code generation disabled, image
  responses omitted, service workers blocked, and a per-context output directory.
- Guard: `npx --offline --yes` fails closed if the pinned package is absent from the
  prebuilt image/cache instead of downloading code at runtime.
- Guard: relative/root output locations and unsafe context IDs are rejected before a
  process command can be produced.
- Guard: unrestricted file access, `--no-sandbox`, optional capabilities, shared
  contexts, and persistent browser profiles are not enabled.

Safety and scope:

- This slice is a pure builder with no subprocess, browser, filesystem write, model,
  Slack API, credential, external integration, cloud resource, or deployment action.
- The process launcher, stdio MCP lifecycle, and restricted tool/result mapping remain
  separate isolated slices.

Commands and evidence:

- MCP process/context-factory scope — `6 passed`.
- Complete explicit offline unit/integration gate — `331 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a pinned and hardened mock-safe MCP process contract. The
stdio lifecycle adapter is the next isolated browser-runtime slice.

## 2026-09-08 — Phase 3: fail-closed Playwright MCP stdio lifecycle

Isolated slice: added the managed subprocess lifecycle for the pinned Playwright MCP
process specification, with stdio-only communication and deterministic cleanup.

Reason: the reviewed process command still had no execution boundary. Starting a child
without proving stdio availability or guaranteeing reaping could leak processes,
browser contexts, and resources across attempts or leave an unusable transport in the
workflow.

Guidance and reference:

- `tdd` guided five vertical lifecycle behaviors through the public start/close API.
- The previously reviewed `@playwright/mcp@0.0.80` process specification remains the
  only accepted launch input. MCP initialization and tool mapping remain separate.

TDD evidence:

- Red/green tracer: a started stdio process is exposed through a managed handle and is
  always terminated and reaped on close.
- Guard: missing stdin or stdout fails closed, terminating and reaping the unusable
  child before returning an error.
- Guard: a graceful-shutdown timeout escalates to kill and waits for process exit.
- Guard: cancellation also kills and reaps the child before propagating cancellation.
- Guard: spawn failures become a stable availability error without exposing OS error
  details to higher workflow layers.

Safety and scope:

- The concrete spawner uses argument-vector execution without a shell, stdin/stdout
  pipes, discarded stderr, a fixed minimal `PATH` with no inherited ambient or secret
  variables, and a separate process session.
- Tests inject only process-boundary doubles. No pinned package was executed or
  installed, and no browser, model, Slack API, credential, external integration, cloud
  resource, or deployment was used.

Commands and evidence:

- MCP lifecycle/process/context blast radius — `11 passed`.
- Complete explicit offline unit/integration gate — `336 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for fail-closed mock-safe MCP subprocess ownership. The MCP
initialize handshake and strict tool-response contract remain the next isolated slice.

## 2026-09-08 — Phase 3: pinned Playwright MCP initialize handshake

Isolated slice: added a bounded JSON-RPC stdio client that completes the legacy MCP
initialize lifecycle required by the SDK bundled with `@playwright/mcp@0.0.80`.

Reason: owning the child process did not establish protocol compatibility or prove that
the server exposes tools. Accepting an unvalidated initialize response could silently
run against a drifted MCP protocol or package and make later browser calls unsafe.

Guidance and reference:

- `tdd` guided the handshake through the public initializer and stdio protocols.
- The exact server dependency uses MCP TypeScript SDK `1.25.2`, whose latest supported
  protocol is `2025-11-25` and whose stdio framing is one JSON-RPC message per newline.
- The client sends `initialize`, validates the response, and only then sends
  `notifications/initialized`.

TDD evidence:

- Red/green tracer: the valid pinned handshake returns typed server identity and emits
  the exact two-message lifecycle.
- Guards: reject protocol drift, package-version drift, missing tools capability,
  malformed JSON-RPC, response errors, wrong correlation IDs, truncated frames, and
  incomplete server identity before the ready notification.
- Bounds: enforce a configurable 128–65,536-byte response limit and a configurable
  0–30-second timeout.
- Boundary failures from broken stdio are mapped to stable errors without exposing OS
  details; cancellation remains propagating.

Safety and scope:

- Tests use only in-memory stdio doubles. No pinned package was executed or installed,
  and no browser, model, Slack API, credential, external integration, cloud resource,
  or deployment was used.
- The lifecycle handle now exposes typed reader/writer protocols for composition while
  retaining the existing terminate/kill/reap behavior.

Commands and evidence:

- MCP initialize/lifecycle/process blast radius — `23 passed`.
- Complete explicit offline unit/integration gate — `350 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a pinned, bounded, fail-closed MCP initialize handshake. A
strict `tools/list` allowlist and `tools/call` response mapper is the next isolated
browser-runtime slice.

## 2026-09-08 — Phase 3: deny-by-default Playwright MCP tool contract

Isolated slice: added strict `tools/list` discovery and bounded `tools/call` response
mapping behind a fixed Qali allowlist for the pinned Playwright MCP server.

Reason: a successfully initialized raw MCP connection still exposes many browser tools,
including unrestricted JavaScript evaluation and file-producing options. Passing that
surface through would bypass the restricted browser facade and its deterministic policy
boundary.

Guidance and reference:

- `tdd` guided tool discovery, call authorization, and response mapping through the
  public tool client with only stdio boundary doubles.
- The allowlist and required input fields follow the generated tool documentation for
  `@playwright/mcp@0.0.80`; extra server tools are ignored and cannot be called.

TDD evidence:

- Red/green tracer: discovery validates the eight required tool definitions and returns
  only Qali's fixed allowlist while ignoring `browser_evaluate`.
- Guards: missing, duplicate, non-object, or required-field-drifted tool definitions
  fail closed; successful discovery is idempotent.
- Calls are denied before discovery, outside the allowlist, or when arguments include
  unrestricted filenames, timed waits, submit behavior, verbose console history, or
  static network resources.
- Successful calls accept only minimal Qali argument shapes and return typed, bounded
  text blocks. JSON-RPC errors, non-text content, wrong IDs, malformed frames, oversized
  responses, and server tool errors are rejected without returning server details.

Safety and scope:

- The subprocess reader buffer is capped at 1 MiB, while tool responses default to a
  tighter 256 KiB application limit and a five-second timeout.
- Tests use only in-memory MCP responses. No package, browser, model, Slack API,
  credential, external integration, cloud resource, or deployment was used.

Commands and evidence:

- MCP tool/initialize/lifecycle/process blast radius — `53 passed`.
- Complete explicit offline unit/integration gate — `380 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for fail-closed MCP tool discovery and response mapping. The
concrete Playwright MCP `BrowserBackend` adapter is the next isolated browser-runtime
slice.

## 2026-09-08 — Phase 3: restricted Playwright MCP browser backend

Isolated slice: added the concrete `BrowserBackend` and backend factory that bind one
approved attempt to the pinned Playwright MCP process, initialization handshake, fixed
tool allowlist, and deterministic response parsers.

Reason: the restricted browser session and context factory still depended on a test
double. This adapter now crosses the production MCP boundary without exposing raw tools,
unrestricted JavaScript, filenames, arbitrary waits, or server-authored verdicts to the
browser specialist.

Guidance and reference:

- `autopilot` verified the prior tool-contract PR was human-merged, green, and fully
  triaged before this branch started.
- `tdd` guided vertical red-green tracers through public backend behavior with only the
  subprocess stdio boundary replaced by an in-memory child.
- The response section, page metadata, snapshot, console, network, and screenshot-link
  formats were checked against the official source bundled by
  `@playwright/mcp@0.0.80` and its exact `playwright-core` dependency.

TDD evidence:

- Red/green: backend startup launches the supplied pinned process specification,
  negotiates the fixed protocol, discovers the allowlist, maps navigation and an inline
  accessibility snapshot, and always closes the managed child.
- Red/green: click, public text, secret fill, and present/absent waits map only to the
  minimal approved tool arguments. Secret text is passed only into the private backend
  call and never returned from its public result.
- Red/green: the pinned server may return an empty text result for non-submitting text
  entry when page metadata is unchanged; the backend follows it with an approved
  accessibility snapshot instead of inventing or reusing a URL.
- Red/green: URL and accessibility observations come from a fresh snapshot; element
  counts are deterministic matching-line counts; console and network observations are
  parsed as integer error counts for harness-owned oracle evaluation.
- Red/green: malformed network output fails closed instead of becoming a zero-error
  false pass. Pinned initialization failures reap the child, and screenshot references
  outside the isolated output root are rejected.
- The backend factory derives the exact process specification from the validated task,
  context ID, and configured output root, preserving per-attempt isolation.

Safety and scope:

- Tests use only in-memory MCP frames and never launch or install Playwright MCP, open a
  browser, resolve a live credential, call a model or Slack API, use cloud resources, or
  deploy anything.
- Page text, snapshots, logs, and paths remain untrusted. Parsers require the pinned
  section shapes, count only recognized network statuses, and return a namespaced
  screenshot reference rather than arbitrary server text.

Commands and evidence:

- Playwright MCP/restricted-browser blast radius — `74 passed`.
- Complete explicit offline unit/integration gate — `390 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.

Phase result: passed for a mock-safe concrete Playwright MCP browser backend. A concrete
failure-evidence capture source and scripted real-browser contract qualification remain
the next isolated browser-runtime slices.

## 2026-09-09 — Phase 3: Playwright MCP failure-evidence capture

Isolated slice: made the concrete Playwright MCP backend factory the capture source for
the existing immutable browser-evidence exporter. Each active attempt now starts the
pinned runtime's trace before its first browser action, collects the final accessibility
snapshot, console events, network events, and PNG screenshot before shutdown, and
packages the trace streams/resources into the required deterministic archive.

Reason: failed browser attempts already required five durable evidence artifacts, but
the production MCP adapter could return only an individual screenshot reference. The
browser backend closes before the harness assigns the deterministic verdict, so it must
collect the bounded local bundle during shutdown and expose it only after the runner
supplies the matching failed task/result scope.

Guidance and reference:

- `autopilot` (`SKILL.md`, local version not declared) confirmed the prior backend PR
  was human-merged and fully triaged before this branch started.
- `tdd` (`SKILL.md`, local version not declared), including its test and mocking
  references, guided red-green tracers through the public factory/capture boundary with
  only in-memory stdio and temporary local artifact doubles.
- The trace capability, response links, console/network formats, and output-size option
  were checked against the official source bundled by `@playwright/mcp@0.0.80` and its
  exact `playwright-core` dependency. The adapter enables only the required `devtools`
  capability while its client continues to deny every tool outside Qali's fixed list.

TDD evidence:

- Red/green: the factory initially had no `capture_failure` implementation and the
  pinned process exposed no approved trace calls. It now retrieves a complete typed
  bundle only for the exact failed scenario/context that created the backend.
- Tracing starts lazily before the first browser action so navigation is included while
  unused contexts do not create empty evidence. Shutdown captures the final snapshot,
  all bounded informational-or-higher console output, recognized network records, the
  default PNG screenshot, and then stops tracing before terminating the child.
- Trace, network, resource, and screenshot references are resolved only beneath the
  isolated context output directory. Absolute/traversal paths, symlinks, duplicate or
  malformed links, missing/empty files, more than 10,000 events/files, and evidence over
  the 50 MB trace or 10 MB screenshot limits fail closed.
- Trace archive entries use stable names, timestamps, order, and permissions, keeping
  immutable retry content deterministic. The server output budget is capped at 65 MB.
- Credential values observed by the private fill boundary are redacted in plain,
  JSON-escaped, and URL-encoded forms across snapshots, console/network records, trace
  streams, and trace resources. A screenshot containing detectable credential bytes is
  rejected rather than published.
- A passing or substituted result cannot retrieve failure evidence, retrieval before
  backend shutdown fails, repeated context creation is rejected, and capture failures
  still reap the managed MCP process.

Safety and scope:

- Tests use only in-memory MCP frames and temporary local bytes. No Playwright package
  or browser was launched, no model/Slack/credential/cloud integration was called, and
  no infrastructure or deployment was created.
- The generated live integration tests were deliberately not supplied credentials. A
  diagnostic full collection reached `396 passed` before the unchanged live Gemini and
  server tests reported one missing-API-key failure and three missing-ADC setup errors;
  the explicit offline gate below is the authoritative validation for this slice.

Commands and evidence:

- Playwright MCP evidence/process/tool blast radius — `49 passed`.
- Complete explicit offline unit/integration gate — `396 passed`.
- `uv run agents-cli lint` — Ruff, Ruff format, codespell, and ty passed.
- `git diff --check` — passed.

Phase result: passed for mock-safe, bounded production failure-evidence capture. A
scripted real-browser contract qualification remains the next isolated browser-runtime
slice and requires its own safe execution evidence.

## 2026-09-09 — Phase 3: Playwright MCP runtime contract qualification

Isolated slice: added an opt-in contract that launches the pinned Playwright MCP npm
package, negotiates the real stdio protocol, validates Qali's restricted tool schemas,
and invokes `browser_snapshot` in a headless isolated Chromium context without
navigating to a target application.

Reason: all prior browser adapter tests used in-memory MCP frames. The real server
reports its embedded Playwright runtime version in `serverInfo.version`, not the npm
package version, so the first qualification correctly failed and exposed that Qali
would reject its own pinned runtime before any browser action.

TDD and contract evidence:

- RED: the opt-in contract first failed because the npm package was not cached, then
  failed at initialization after the exact package was cached because Qali compared
  `serverInfo.version` with `0.0.80`.
- GREEN: Qali now pins `@playwright/mcp@0.0.80` and its reported embedded runtime
  `1.63.0-alpha-2026-08-31` independently. Existing initialization tests continue to
  prove drift is rejected before the ready notification.
- The package tool contract matched Qali's deny-by-default allowlist and required input
  shapes. The live local call launched Chromium and returned the `about:blank`
  accessibility snapshot, proving an actual browser process—not a protocol double—was
  exercised.
- The contract is disabled unless `QALI_RUN_PLAYWRIGHT_MCP_CONTRACT=1`, keeping normal
  tests offline. `QALI_PLAYWRIGHT_MCP_EXECUTABLE_PATH` optionally selects a preinstalled
  local browser without changing production process composition.

Safety and scope:

- No target URL was visited; the browser remained at `about:blank`. No model, Slack,
  credential, cloud, or external application integration was called.
- This macOS 13 host cannot install the Chromium revision bundled with the alpha
  Playwright runtime, so qualification used an already-cached Chromium executable via
  the explicit test-only override. Linux container qualification must still exercise
  the package-managed browser before deployment.

Commands and evidence:

- Focused MCP process/initialize/tool/default-contract gate — `52 passed, 1 skipped`.
- Opt-in real-browser contract with the test-only executable override — `1 passed`.
- Complete explicit offline unit/integration/contract gate — `396 passed, 1 skipped`.
- A diagnostic broad collection reached the same `396 passed, 1 skipped` before the
  unchanged generated live Gemini and server tests reported one missing-API-key failure
  and three missing-ADC setup errors; no live credentials were supplied.

Phase result: passed for the local scripted MCP/browser protocol contract. The next
isolated slice must wire only production browser integrations into runtime composition;
package-managed Linux browser qualification remains a pre-deployment gate.

## 2026-09-09 — Phase 3: production browser runtime composition

Isolated slice: added the live browser composition root that assembles the concrete
pinned Playwright MCP backend/context factory, ADK Browser Executor, immutable GCS
evidence exporter, and a checksum-validating Secret Manager credential resolver into
the existing browser attempt runner.

Reason: every browser component existed, but no runtime path connected them. Test
doubles could therefore still be the only way to construct a feature attempt, and the
credential facade had only a protocol despite the approved requirement to resolve named
references directly from Secret Manager.

TDD evidence:

- RED/GREEN: the first resolver tracer proved an approved resource reference is expanded
  only to `versions/latest`, fetched with a bounded timeout, CRC32C-validated, decoded as
  UTF-8, and returned only across the private credential boundary.
- RED/GREEN: provider exceptions originally leaked their text. They now map to one stable
  credential-unavailable error without resource names or provider details.
- Guards reject cross-project references before SDK access, corrupt/empty/oversized
  payloads, invalid UTF-8, invalid runtime settings, and missing live environment values.
- RED/GREEN: the production factory now shares one concrete MCP backend factory between
  fresh context creation and failure capture, publishes evidence through the GCS
  repository, and uses the concrete ADK executor and Secret Manager resolver. No
  in-memory repository or browser double is available from this composition root.
- Environment composition requires explicit live mode, Gemini Developer API mode and a
  key, GCP project, artifact bucket/timeouts, isolated MCP output root, and Secret
  Manager timeout before creating any production adapter.

Safety and scope:

- Tests replace only Google SDK factory boundaries. Qali's context, executor, evidence,
  policy, and attempt-runner implementations are real.
- Test credentials are synthetic bytes and never enter prompts or logs. No Playwright
  child, model call, Slack API, Secret Manager/GCS request, cloud resource, target
  integration, or deployment was used.
- Secret values are bounded to 64 KiB and integrity checked before decoding. Production
  resource references are confined to the configured GCP project.

Commands and evidence:

- Browser runtime and Secret Manager composition/security suite — `15 passed`.
- Browser integration blast-radius suite — `43 passed`.
- Complete explicit offline unit/integration/contract gate — `411 passed, 1 skipped`.

Phase result: passed for fail-closed production browser attempt composition. The next
isolated feature-testing slice must install this runner into the feature worker runtime;
live credentials, external targets, infrastructure, and deployment remain separately
approval-gated.

## 2026-09-09 — Phase 3: production feature workflow composition

Isolated slice: installed the production browser attempt runner into the complete
one-feature request workflow, including reviewed planning, scenario execution, fresh
failure reproduction, immutable run-artifact publication, and concise Slack results.

Reason: the production browser composition existed in isolation, while the complete
feature workflow could still only be assembled manually from test doubles. Failure
investigation also required a differently named reproduction boundary even though it
must use the exact same guarded fresh-context attempt path.

TDD evidence:

- RED/GREEN: no production feature composition module existed. The new factory now
  installs one production browser runner as both the initial scenario runner and the
  failure reproducer, composes all specialist and independent reviewer agents, writes
  run artifacts through GCS, and publishes the final result through the Slack client
  boundary.
- RED/GREEN: `BrowserAttemptRunner` did not satisfy the failure reproducer contract.
  Its public `reproduce` operation now delegates to the same context reservation,
  restricted execution, deterministic verdict, and failure-evidence path as an initial
  attempt; the existing context-ID guard therefore enforces fresh isolation across both.
- The production factory exposes no in-memory artifact repository, browser session, or
  Slack result publisher. Tests replace only the browser/GCS construction boundaries
  and the external Slack client while exercising Qali's real composition logic.

Safety and scope:

- The factory receives the already validated browser runtime settings and preserves the
  explicit specialist/reviewer model boundaries without changing the pinned model.
- No model request, Playwright process, browser, Slack API, Secret Manager/GCS request,
  cloud resource, target integration, or deployment was used.

Commands and evidence:

- Feature runtime and shared browser reproduction suite — `7 passed`.
- Feature workflow/browser runtime blast-radius suite — `36 passed`.
- Complete explicit offline unit/integration/contract gate — `413 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for production one-feature workflow composition. A later isolated
slice must add the typed feature-job HTTP/lifecycle boundary and project-knowledge task
construction before live qualification; all external use remains approval-gated.

## 2026-09-09 — Phase 3: typed feature-job worker boundary

Isolated slice: added a dedicated typed Cloud Tasks intake and lifecycle processor for
one live feature-test job, while making the shared claim/timeout/retry handler generic
over its validated job contract.

Reason: the production feature workflow had no authenticated HTTP job boundary. The
existing worker accepted only onboarding payloads, so feature execution could not be
claimed once, associated with one Slack progress message, or safely redelivered.

TDD evidence:

- RED/GREEN: no `FeatureTestJob` or feature worker endpoint existed. A validated
  `test_feature` payload now reaches the task-loader and feature-workflow boundaries
  through `/internal/feature-jobs`, completes once, and becomes a no-op on redelivery.
- The processor creates or recovers exactly one progress message, requires the loaded
  live request task to match the claimed project, request, run, feature, and message,
  and rejects mock-mode task construction before browser execution.
- Queue identity, deterministic Cloud Tasks name, delivery-attempt budget, project-busy
  handling, timeout, retry, and terminal completion remain governed by the existing
  worker lifecycle behavior rather than a second implementation.
- The lifecycle protocols are generic only at the typed job seam; existing onboarding
  behavior remains unchanged and passes its worker regression suite.

Safety and scope:

- Project knowledge and browser target policy are deliberately loaded behind the task
  construction boundary and are not accepted from the queued Slack request as
  authority. Their production repository composition remains the next isolated slice.
- No model request, browser, Slack API, credential, Cloud Tasks/Firestore/GCS request,
  cloud resource, target integration, or deployment was used.

Commands and evidence:

- Feature and onboarding worker lifecycle blast-radius suite — `15 passed`.
- Complete explicit offline unit/integration/contract gate — `414 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for typed, idempotent feature-job intake. The next isolated slice
must load approved compiled knowledge and browser policy into a matching live
`FeatureRequestTask`; external qualification remains approval-gated.

## 2026-09-09 — Phase 3: approved feature context task loader

Isolated slice: added the fail-closed application boundary that loads one approved
project context and builds the live `FeatureRequestTask` consumed by the production
feature workflow.

Reason: the typed feature job intentionally carries no project knowledge, browser URL,
credentials, or action policy. Those authoritative values must come from Qali's stored
project context after the job is claimed, while the Slack payload contributes only the
requested feature and run identity.

TDD evidence:

- RED/GREEN: no feature-context loader existed. A ready context now supplies the
  structured compiled knowledge and browser target policy while the claimed job supplies
  the request, run ID, feature slug, and Slack scope.
- RED/GREEN: repository/provider failures originally exposed their details. They now map
  to one stable context-unavailable error without project or provider text.
- Guards reject insufficient knowledge, a workspace/channel mismatch, cross-project
  knowledge or browser policy, and any context that cannot pass strict schema validation.
- The loader always produces `mock_mode=False`; the downstream feature-job processor
  independently rechecks the task against the claimed job before execution.

Safety and scope:

- The queued job cannot provide or override target origins, credential references,
  consequential-action permissions, step limits, timeouts, or compiled project facts.
- Tests replace only the project-context repository boundary. No model request, browser,
  Slack API, credential, storage request, cloud resource, target integration, or
  deployment was used.

Commands and evidence:

- Approved feature-context loader suite — `4 passed`.
- Feature context/job/request blast-radius suite — `12 passed`.
- Complete explicit offline unit/integration/contract gate — `418 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for authoritative live task construction. The next isolated slice
must persist and retrieve the approved structured feature context through production
storage before the complete worker can be composed from environment settings.

## 2026-09-09 — Phase 3: durable approved feature context

Isolated slice: added the production GCS repository for the complete approved feature
context: Slack project binding, readiness, structured compiled knowledge, and the
deny-by-default browser target policy.

Reason: the live task loader had only a repository protocol. Without a durable,
integrity-checked implementation, a worker restart could not recover the authoritative
knowledge and action policy needed to build the same feature request.

TDD evidence:

- RED/GREEN: no feature-context persistence adapter existed. A ready context now writes
  canonical JSON under `projects/{project_id}/context/feature.json` with a generation
  precondition, content checksum, project metadata, and a bounded request timeout, then
  reloads through strict schema and scope validation.
- RED/GREEN: an identical redelivery initially surfaced GCS's precondition failure. It
  now resolves only when remote bytes, digest, project metadata, and generation exactly
  match; changed stale content raises a stable generation conflict.
- RED/GREEN: an insufficient context could initially reach the storage write. Publication
  now rejects it before touching GCS, so only a ready project can be stored as approved.
- Load rejects missing/corrupt metadata, an invalid generation, unsafe or mismatched
  project identity, malformed JSON/schema, provider failures, and content tampering with
  one redacted context-unavailable error.

Safety and scope:

- The adapter stores secret references only; credential values remain exclusively behind
  Secret Manager resolution and never enter context JSON.
- Tests use an in-memory GCS boundary. No browser, model, Slack API, credential, storage
  service, cloud resource, target integration, or deployment was used.

Commands and evidence:

- GCS feature-context repository suite — `5 passed`.
- Context persistence/loading/worker blast-radius suite — `10 passed`.
- Complete explicit offline unit/integration/contract gate — `423 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for restart-safe approved context storage. The next isolated slice
must compose this repository, the live task loader, feature workflow, Slack progress,
and durable feature-job lifecycle from fail-closed environment settings.

## 2026-09-09 — Phase 3: complete feature worker environment composition

Isolated slice: added one fail-closed environment factory that composes the durable
Firestore feature-job lifecycle, approved GCS context loader, production browser and
specialist workflow, same-thread Slack progress, and final Slack result publication.

Reason: the individual production adapters and typed worker boundary existed, but there
was no deployable application composition root. The shared Firestore repository also
parsed every claimed document as an onboarding job, so a persisted feature job could
not traverse the real lifecycle after a worker restart.

TDD evidence:

- RED/GREEN: importing the live feature-worker environment factory failed. Explicit,
  fully validated environment settings now build one FastAPI worker while keeping the
  Slack client shared between progress and final-result publication.
- RED/GREEN: a persisted `test_feature` document failed onboarding-job validation when
  claimed. The durable repository now discriminates the two approved job kinds and
  completes the same claim, lock, progress-reference, retry, failure, and completion
  lifecycle for either typed payload.
- The feature progress reporter posts one concise request-received message in the
  originating Slack thread and requires Slack to return a message timestamp before the
  job can continue.
- Missing mode, free-tier, model-key, Firestore, GCS, queue, Slack, browser, credential,
  or execution settings fail before an external adapter is created.

Safety and scope:

- Tests replace only Firestore, GCS, Slack, browser, and model system boundaries. No
  browser process, model request, Slack API, credential lookup, storage service, cloud
  resource, target integration, or deployment was used.
- The factory requires live mode and the Gemini Developer API path; Vertex AI remains
  rejected for this free-tier MVP boundary.

Commands and evidence:

- Feature worker, context, Slack progress, and Firestore lifecycle suite — `42 passed`.
- Complete explicit offline unit/integration/contract gate — `443 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for restart-safe production feature-worker composition. The next
isolated slice must route an authorized one-feature Slack request into the typed durable
feature job and Cloud Tasks boundary without expanding onboarding semantics.

## 2026-09-09 — Phase 3: authorized Slack feature-job dispatch

Isolated slice: extended the signed Slack ingress to turn one authorized `test ...`
mention into a typed, project-scoped feature job and route it to a separately configured
feature-worker Cloud Tasks target.

Reason: the complete feature worker could process a typed job, but the Slack ingress
acknowledged every non-onboarding request without durable creation or dispatch. Reusing
the onboarding worker URL would also send the new payload to the wrong HTTP contract.

TDD evidence:

- RED/GREEN: a signed feature mention could not supply a feature dispatcher and created
  no job. It now creates one deterministic `FeatureTestJob`, derives the same stable
  Slack channel project identity used during onboarding, and dispatches only through the
  feature task boundary.
- RED/GREEN: live ingress created only the onboarding Cloud Tasks adapter and did not
  require feature-worker configuration. It now validates and composes distinct HTTPS
  worker URL and OIDC audience settings before creating any external adapter.
- The feature run ID and provisional feature slug are deterministic, bounded hashes of
  the Slack event and normalized request. Natural-language feature meaning remains the
  responsibility of the grounded Product Alignment workflow rather than ingress code.
- The generic Cloud Tasks adapter preserves the complete typed feature payload and uses
  deterministic task naming, authenticated delivery, and duplicate-task idempotency.

Safety and scope:

- Existing authorization, Slack signature, replay-window, private workspace/channel,
  and owner checks run before feature routing. Requests without a configured feature
  dispatcher fail closed without being sent to the onboarding worker.
- Tests use in-memory job/task boundaries and recorded cloud requests. No Slack API,
  Cloud Tasks, browser, model, credential, storage service, cloud resource, target
  integration, or deployment was used.

Commands and evidence:

- Slack ingress, task routing, project identity, and durable lifecycle suite —
  `57 passed`.
- Complete explicit offline unit/integration/contract gate — `447 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for signed one-feature request dispatch into the production worker
contract. The next isolated slice must publish the approved feature context from a
successful onboarding result so a live feature job can load it without manual seeding.

## 2026-09-09 — Phase 3: onboarding feature-context publication

Isolated slice: connected a successful reviewed onboarding result to the durable
approved feature-context repository, including its Slack binding and explicit browser
target policy.

Reason: feature dispatch and the complete feature worker were live-composable, but the
worker's authoritative context object still required manual seeding. A successful
onboarding run therefore could not make the same project testable after a process
restart.

TDD evidence:

- RED/GREEN: the onboarding worker rejected feature-context publication dependencies.
  A ready result now publishes the exact reviewed `KnowledgeCompilation`, project and
  Slack scope, readiness decision, and deny-by-default `BrowserTargetPolicy` before the
  worker reports completion.
- RED/GREEN: the live onboarding environment did not create the GCS context adapter or
  require a target policy. It now validates the complete policy JSON first, composes the
  repository against the private artifacts bucket, and exposes only the typed policy in
  application state for runtime inspection.
- Insufficient knowledge returns without context publication. Project, workspace,
  channel, or browser-policy scope drift fails the onboarding job instead of publishing
  mismatched authority.
- Initial and identical redeliveries use generation zero; the GCS adapter's existing
  byte, digest, metadata, and generation checks remain the idempotency boundary.

Safety and scope:

- Browser origins, actions, credential references, consequential actions, step budget,
  and timeout come from explicit validated configuration, not model output. Credential
  values remain outside the context and behind Secret Manager resolution.
- Tests use in-memory publication boundaries and synthetic policy data. No browser,
  model API, Slack API, credential lookup, storage service, cloud resource, target
  integration, or deployment was used.

Commands and evidence:

- Onboarding, knowledge, feature-context, and environment blast-radius suite —
  `45 passed`.
- Complete explicit offline unit/integration/contract gate — `448 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for automatic onboarding-to-feature authority publication. The
next isolated slice must connect grounded finding follow-up requests to immutable run
artifacts and concise same-thread Slack explanations.

## 2026-09-09 — Phase 3: durable finding follow-up dispatch

Isolated slice: routed signed `explain finding-…` Slack mentions through the durable
job boundary, resolved the originating run from immutable finding metadata, rebuilt
the validated run record, and posted the existing concise grounded explanation in the
originating thread.

Reason: the result renderer could already explain a finding from an in-memory run
record, but a later Slack request could not recover that record after a process restart
or reach a production worker.

TDD evidence:

- RED/GREEN: no persisted follow-up processor existed. It now resolves a finding to its
  immutable run, reads the request, plan, and result artifacts, validates their content
  types, scope, counts, verdicts, and finding identities, then renders without rerunning
  a browser or model.
- RED/GREEN: GCS exposed only create-only publication. Production and in-memory
  repositories now support hash-verified reads and project-scoped finding-to-run
  resolution using immutable artifact metadata.
- RED/GREEN: signed Slack ingress ignored finding explanations. It now creates one
  typed `ExplainFindingJob` for an exact stable finding ID, persists it in the shared
  durable lifecycle, and dispatches it to the feature worker.
- RED/GREEN: the feature worker accepted only feature-test jobs. The authenticated
  Cloud Tasks endpoint now selects the dedicated follow-up lifecycle handler and posts
  in the originating Slack thread with a stable `client_msg_id` for retry safety.

Safety and scope:

- Project and finding identifiers constrain all object names; resolved run IDs are
  validated before reads. Artifact hashes and typed cross-document invariants fail
  closed before any Slack publication.
- Follow-up text remains essentials-first and excludes fingerprints, context IDs, and
  secret references. Tests use in-memory storage, Slack, task, and lifecycle doubles.
  No live Slack API, storage service, browser, model, credential, cloud resource,
  target integration, or deployment was used.

Commands and evidence:

- Finding follow-up, ingress, storage, worker, Firestore, and task blast-radius suite —
  `64 passed`.
- Complete explicit offline unit/integration/contract gate — `455 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for restart-safe, same-thread finding explanations from immutable
evidence. The next isolated slice must compose deterministic testing-log and issue-index
projection publication into the completed feature-run path.

## 2026-09-09 — Phase 3: completed-run projection publication

Isolated slice: rebuilt each project's chronological testing log and current issue
index from immutable feature-run history after every completed run, then wired the
projection refresh into the production feature worker before Slack success publication.

Reason: deterministic projection compilers and generation-guarded GCS writers existed,
but the live feature workflow never invoked them. Project logs and issue indexes could
therefore remain stale even when immutable run artifacts and Slack results succeeded.

TDD evidence:

- RED/GREEN: a completed workflow persisted run artifacts but did not refresh project
  views. It now publishes both projections after immutable artifacts and before the
  Slack result, and fails closed without a success message if projection publication
  fails.
- RED/GREEN: projection code had no durable history source. Run-artifact repositories
  now enumerate validated result pointers with immutable creation timestamps, and a
  shared typed loader reconstructs cross-checked run records for both projections and
  finding follow-ups.
- RED/GREEN: two sequential runs now regenerate a chronological log containing both
  exact outcomes and an issue index derived from the complete persisted history.
- RED/GREEN: projection publishers now expose current generations; production uses GCS
  generation preconditions while the in-memory path preserves equivalent behavior.
- Live worker composition shares one run-artifact repository across execution,
  follow-up, and history reads, and creates the production projection repository only
  after all environment configuration validates.

Safety and scope:

- History enumeration is project-prefix scoped. Listed run IDs and timestamps pass
  typed validation, every loaded artifact is hash-verified, and all cross-document
  counts, verdicts, findings, and project/run identities fail closed before projection
  or Slack publication.
- Tests use synthetic feature records and in-memory or recorded storage boundaries. No
  Slack API, storage service, browser, model, credential, cloud resource, target
  integration, or deployment was used.

Commands and evidence:

- Feature workflow, projection, history, follow-up, and live-composition blast radius —
  `46 passed`.
- Complete explicit offline unit/integration/contract gate — `458 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for fail-closed project projection publication from durable run
truth. The next isolated slice must add the bounded Slack-facing coordinator that routes
only onboarding, one-feature testing, and finding explanations from natural language.

## 2026-09-09 — Phase 3: bounded Slack coordinator

Isolated slice: replaced the generated demonstration agent with a tool-free ADK
coordinator that classifies one natural-language Slack request into the three approved
Qali workflows or returns one clarification question.

Reason: the deterministic onboarding, feature-testing, and finding-follow-up workflows
were production-composed, but the generated ADK root still exposed unrelated weather
tools and had no typed Qali routing contract.

TDD evidence:

- RED/GREEN: coordinator tests initially failed because no routing module existed. The
  new typed request and decision schemas now constrain ready decisions to exactly one
  of `onboard_project`, `test_feature`, or `explain_finding`.
- RED/GREEN: an explanation route may select only a syntactically valid finding ID
  present in the supplied project context; invented identifiers fail closed.
- RED/GREEN: feature testing cannot dispatch before the project is ready, and
  ambiguous, unsupported, or multi-feature requests must return a question without a
  workflow.
- The isolated ADK adapter sends only the typed request into a fresh in-memory session,
  rejects invalid structured output, and exposes no tools or conversation history.

Official implementation study:

- Re-read `google-agents-cli-workflow` and `google-agents-cli-adk-code` for Agents CLI
  1.4.2, then inspected the installed `Agent` signature and the structured-output and
  workflow references before coding.
- Revisited `ambient-expense-agent` for deterministic business routing around bounded
  model judgment and `long-horizon-harness` for isolated child-context contracts.
  Qali adapts those ideas to one schema-only coordinator and existing application-owned
  workflows; it does not copy Pub/Sub, background agents, general tools, or cloud
  infrastructure.

Safety and scope:

- The model receives no storage primitive, browser, secret, shell, Git, deployment,
  arbitrary network, or workflow-execution tool. Application code remains responsible
  for authorization, lifecycle, persistence, dispatch, execution, and publication.
- Tests use a deterministic `BaseLlm` double. No Slack API, browser, storage service,
  real model, credential, cloud resource, target integration, or deployment was used.

Commands and evidence:

- Focused coordinator schema, isolated-agent, and generated root-surface suite —
  `8 passed`.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `466 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for bounded, typed natural-language routing with no coordinator
tools or hidden history. The next isolated slice should add coordinator behavioral eval
cases and trajectory qualification through the existing workflow boundaries.

## 2026-09-09 — Phase 4: coordinator evaluation assets

Isolated slice: replaced the generated weather/general-assistant evaluation examples
with typed coordinator-routing cases, a local deterministic route-contract metric, and
a disjoint held-out set for the final gate.

Reason: the ADK root now accepts `CoordinatorRequest` JSON and returns a
`CoordinatorDecision`, so the scaffolded free-form examples could not evaluate the
Qali surface. Routing correctness is schema-exact and does not require an LLM judge.

TDD evidence:

- RED/GREEN: the eval-asset test initially failed because the coordinator dataset and
  metric did not exist. The core dataset now covers all three approved workflows plus
  multi-feature ambiguity, missing onboarding, and an unknown-finding injection.
- RED/GREEN: the local metric parses both response and reference through the production
  decision schema, compares status/workflow/finding identity, and rejects prose or
  malformed output instead of crediting substring matches.
- A separate held-out dataset covers an unsupported general question and a project
  knowledge update. Tests verify its schemas and disjoint case IDs without running it
  during prompt iteration.

Skill and implementation protocol:

- Re-read `google-agents-cli-eval` version 1.4.2 and its dataset/metric references.
  The installed CLI has no offline dataset-validation command, so deterministic pytest
  validates the committed assets and the CLI's local code metric remains the eventual
  scoring path.

Safety and scope:

- Every case is synthetic and project-agnostic. The route metric runs locally, performs
  no network or model call, and uses the same Pydantic decision contract as production.
- `agents-cli eval run` was deliberately not invoked: inference would call the live
  Gemini integration, which requires explicit approval and an eligible free-tier
  credential. No secret, cloud resource, live integration, or deployment was used.

Commands and evidence:

- Focused eval dataset and metric contract suite — `4 passed`.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `470 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Phase result: passed for typed coordinator core/held-out datasets and deterministic
route scoring. Live core and held-out scores remain a separate explicitly approved
qualification step.

## 2026-09-09 — Phase 4: bounded free-tier model runtime policy

Isolated slice: centralized the default Gemini construction and generation settings
used by every Qali ADK agent, including the restricted browser executor.

Reason: per-agent retry defaults could silently diverge, and unqualified HTTP status
retries risked spending the remaining free quota after a 429 response. Output size was
also bounded only by schemas rather than an explicit provider request ceiling.

TDD evidence:

- RED: a cross-agent contract test showed every specialist still used the SDK's
  unqualified retry status set and had no output-token limit.
- GREEN: all default model factories now share the pinned `gemini-3.7-flash` model,
  temperature `0`, a `4096` output-token ceiling, and three total attempts with
  bounded backoff for HTTP `408`, `500`, `502`, `503`, and `504` only.
- GREEN: the browser executor has an integration-level assertion for the same policy,
  preventing its tool-bearing execution path from drifting from tool-free agents.

Implementation verification:

- Inspected the installed Google Gen AI `HttpRetryOptions` and
  `GenerateContentConfig` fields before writing the shared factory.
- Repository search confirms production constructs `Gemini`, `HttpRetryOptions`, and
  `GenerateContentConfig` only in `app/model_runtime.py`.
- Focused model policy and browser executor suite — `16 passed`.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `482 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Safety and scope:

- HTTP 429 is not retried inside the model SDK, so free-quota exhaustion propagates to
  the existing application-owned failure and task-retry boundaries without a paid
  model or Vertex AI fallback.
- Tests construct agents but use no live model, API key, network integration, cloud
  resource, browser, Slack API, deployment, or secret.

## 2026-09-09 — Phase 4: isolated ADK invocation timeout

Isolated slice: added a code-owned 300-second wall-clock timeout around every
isolated structured ADK run.

Reason: provider-level retry and token ceilings do not bound a stalled model stream or
multi-step agent invocation. The worker has a broader job timeout, but specialist
invocations also need a local cancellation boundary that leaves time for durable job
release and retry handling.

TDD evidence:

- RED: a deterministic hanging `BaseLlm` double could keep the isolated runner open
  indefinitely because the shared runtime exposed no timeout boundary.
- GREEN: the public runtime accepts a testable timeout, defaults production calls to
  300 seconds, cancels the runner on expiry, and raises only
  `structured agent invocation timed out` without request text or exception chaining.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `483 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Safety and scope:

- The timeout wraps the whole isolated agent invocation, including bounded browser
  tool turns, while remaining below the existing 15-minute worker budget.
- The test uses a deterministic hanging model double. No live Gemini request, API key,
  browser, Slack API, storage, cloud resource, target integration, deployment, or
  secret was used.

## 2026-09-09 — Phase 4: per-invocation model request budgets

Isolated slice: replaced ADK's 500-call default with explicit request ceilings for
Qali's tool-free specialists and browser executor.

Reason: retry and timeout limits still allowed a looping agent to consume hundreds of
free-tier requests within one invocation. The allowed call count must derive from the
agent's actual responsibility rather than the framework default.

TDD evidence:

- RED: a deterministic model that repeatedly called a harmless tool had no Qali-owned
  request ceiling, and the shared runtime did not expose a stable budget error.
- GREEN: tool-free invocations default to one model request and translate ADK budget
  exhaustion to `structured agent model request budget exceeded` without exception
  chaining.
- GREEN: browser execution receives only `target_policy.max_steps + 1` model calls,
  covering approved action turns plus final structured completion. The existing
  multi-turn browser integration path remains green.

Official implementation study:

- Inspected the installed ADK 2.8.0 `RunConfig` and `Runner.run_async` signatures.
  Qali now uses native `RunConfig.max_llm_calls` instead of implementing a parallel
  counter; the installed framework default was 500.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `484 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Safety and scope:

- Budget errors contain no prompt, model output, target data, or credentials and flow
  into the existing application-owned job retry/failure boundary.
- Tests use deterministic model and browser doubles. No live Gemini request, API key,
  browser, Slack API, storage, cloud resource, target integration, deployment, or
  secret was used.

## 2026-09-09 — Phase 4: process-level model concurrency gate

Isolated slice: bounded each worker process to two active structured ADK invocations.

Reason: per-invocation request and time ceilings do not prevent concurrent jobs from
bursting free-tier model traffic. Qali still requires the intentionally parallel QA
Strategy and Risk analysis pair, so the process limit must permit exactly that fan-out
without allowing a third invocation to enter.

TDD evidence:

- RED: three isolated agents backed by deterministic blocking model doubles entered
  model generation concurrently and reached a peak of three.
- GREEN: the shared runtime gate admits two invocations and holds the third until a
  slot is released. All three then complete with their typed results.
- The 300-second invocation timeout includes time spent waiting for the gate, so a
  queued call cannot wait indefinitely outside Qali's wall-clock budget.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `485 passed, 1 skipped`.
- Agents CLI lint (Ruff, format, codespell, and ty) — passed.

Safety and scope:

- The gate is process-local and code-owned. It adds no distributed lock, queue,
  environment toggle, cloud resource, or provider-specific integration.
- Tests use deterministic blocking model doubles. No live Gemini request, API key,
  browser, Slack API, storage, cloud resource, target integration, deployment, or
  secret was used.

## 2026-09-10 — Phase 4: private-MVP release readiness runbook

Isolated slice: added a versioned fail-closed go/no-go checklist, live qualification
gates, rollback triggers/procedure, and post-deployment verification sequence.

Reason: implementation and mock validation are not release evidence. The committed
plan requires live Gemini, GCP, Slack, Playwright, SauceDemo, observability, restart,
and rollback proof, but the repository had no auditable artifact that prevents those
pending gates from being treated as complete.

TDD and release-readiness evidence:

- RED: the release contract failed because `docs/release-readiness.md` did not exist.
- GREEN: the runbook now states NO-GO, names the sole decision authority, distinguishes
  completed offline evidence from pending live evidence, and requires the exact eval,
  real-browser, Slack, persistence, trace, and failure-path acceptance thresholds.
- The rollback section defines baseline-relative and critical-safety triggers before
  deployment, restores an immutable previous revision, preserves evidence, and requires
  immediate health/read-only smoke verification.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `486 passed, 1 skipped`.
- Agents CLI 1.4.2 lint (Ruff, format, codespell, and ty) — passed. Version 1.5.0 was
  advertised but not installed during this isolated release-documentation slice.

Safety and scope:

- The runbook contains no credential values or live endpoints and its contract rejects
  common secret assignment examples.
- No eval, model, browser, Slack API, storage, cloud resource, deployment, credential,
  or external integration was used. Current release status remains NO-GO.

## 2026-09-10 — Phase 4: secure Cloud Run scaffold baseline

Isolated slice: enhanced the existing Agents CLI project for Cloud Run, then reduced
the generated Terraform to a reviewable, non-deployed security baseline.

Required skills and official references:

- Agents CLI scaffold and deploy skills, CLI 1.4.2.
- Cloud Run and generated Terraform deployment references bundled with those skills.
- `uv run agents-cli info` confirmed project `qali`, agent directory `app`, A2A
  enabled, region `europe-west1`, and the pre-enhancement deployment target `none`.
- Ran `uv run agents-cli scaffold enhance . --deployment-target cloud_run
  --cicd-runner skip`; no infrastructure or deployment command was run.

TDD and review evidence:

- RED: the generated baseline exposed public ingress, kept one warm instance, allowed
  eight concurrent requests, enabled Vertex AI and BigQuery completion telemetry,
  captured model content, and granted broad project roles.
- GREEN: the checked-in baseline is internal-only, scale-to-zero, concurrency one,
  max instance one, session-affinity disabled, Gemini Developer API only, and no
  completion-content upload. Broad storage/Vertex roles, default-compute grants, paid
  APIs, telemetry resources, and obsolete generated weather eval assets were removed.
- RED/GREEN: repository policy ignores Terraform working directories, state files,
  and saved plan artifacts while allowing the generated dependency lock file to be
  committed after the first validated initialization.
- Review fix: the generated Google provider is now the configured default provider,
  so every unqualified Google resource uses the reviewed project, region, and billing
  override settings.
- Scoped scaffold/configuration tests — `9 passed`.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `488 passed, 1 skipped`.
- Agents CLI 1.4.2 lint (Ruff, format, codespell, and ty) — passed.

Safety and scope:

- The generated placeholder service is a reviewed baseline only. It does not yet
  implement the separate Slack ingress/browser worker, Cloud Tasks, Firestore, GCS,
  Secret Manager, retention, alerting, or least-privilege resource IAM required by the
  committed plan.
- Terraform/OpenTofu is not installed locally, so this slice relies on static contract
  tests and does not claim a Terraform validate result.
- No API was enabled, resource created, plan applied, image built, credential read,
  model invoked, integration contacted, or deployment performed. Release status
  remains NO-GO.

## 2026-09-10 — Phase 4: unified worker runtime

Isolated slice: composed onboarding, feature-test, and finding-follow-up HTTP routes
behind one worker application factory so the deployment topology does not need a
separate service for each specialist workflow.

Required skill and official references:

- Agents CLI deploy skill 1.4.2, including its Cloud Run and custom Terraform
  references. The reference confirms that Cloud Run serves a unified FastAPI app and
  that custom single-project resources stay under the generated Terraform directory.

TDD evidence:

- RED/GREEN 1: no unified worker module existed; the public composition factory now
  serves both `/internal/jobs` and `/internal/feature-jobs` plus a content-free health
  response from one ASGI application.
- RED/GREEN 2: overlapping method/path registrations were silently order-dependent;
  composition now rejects a duplicate worker route before serving traffic.
- RED/GREEN 3: no production factory composed both fail-closed environment runtimes;
  `create_worker_runtime_from_env` now passes one environment to the onboarding and
  feature factories and exposes their routes from one live-mode app.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `491 passed, 1 skipped`.
- Agents CLI 1.4.2 lint (Ruff, format, codespell, and ty) — passed.

Safety and scope:

- Existing typed handlers retain their Cloud Tasks provenance checks, lifecycle
  controls, project serialization, and injected test doubles; this layer only unifies
  their HTTP surface.
- No Terraform resource, queue, storage, secret, IAM grant, image, model, browser,
  Slack API, credential, cloud call, or deployment was created or used. Release status
  remains NO-GO.

## 2026-09-10 — Phase 4: two-service Cloud Run topology

Isolated slice: replaced the generated placeholder service with separate Slack ingress
and unified worker Cloud Run definitions that execute the repository's production
factories.

Required skill and official references:

- Agents CLI deploy skill 1.4.2, including the Cloud Run scaling/networking and custom
  Terraform references. The implementation remains inside the generated
  `deployment/terraform/single-project/` structure.

TDD evidence:

- RED/GREEN 1: Terraform described one placeholder hello service; it now defines the
  signed Slack ingress and unified worker factories as two independently scaled Cloud
  Run services sharing one approved container image.
- RED/GREEN 2: both services used one runtime identity; ingress and worker now have
  distinct service accounts and separately bounded base role sets.
- RED/GREEN 3: a mutable or placeholder image could reach the service definitions;
  the required `container_image` variable now accepts only an immutable sha256 digest.
- The ingress scales from zero to two instances at concurrency eight. The browser
  worker is internal-only, scales from zero to one instance, uses concurrency one, and
  has the existing 15-minute request ceiling.
- Complete credential-free unit/integration/contract gate, excluding only the
  generated ADC-dependent server E2E probe — `494 passed, 1 skipped`.
- Agents CLI 1.4.2 lint (Ruff, format, codespell, and ty) — passed.

Safety and scope:

- The Slack service has external network ingress because Slack cannot originate from
  the private worker boundary, but this slice intentionally does not add an invoker
  policy. The later IAM slice must expose only the signed Slack endpoint and preserve
  private authenticated worker invocation.
- No Cloud Tasks queue, database, bucket, secret, service invoker grant, resource-level
  IAM, image, plan, apply, credential, model, browser, Slack API, cloud call, or
  deployment was created or used. Release status remains NO-GO.
