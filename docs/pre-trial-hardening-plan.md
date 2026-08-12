# Qali Pre-Trial Hardening and Full E2E Plan

## Summary

The previous plan had the correct scope but needed tighter sequencing and stronger E2E evidence.

Key refinements:

- Qali is already live: `qali-slack-control` is deployed, GitHub is connected to `hlemmur/qali`, and Slack has private `#test-qali`.
- Existing live runs prove transport, not correct execution. Several workflows report “passed” without substantive work.
- Cursor’s sandbox is defense-in-depth. Primary isolation is an ephemeral container/workspace with restricted files, tools, network, and no unrelated secrets.
- Every workflow receives an explicit harness profile; Cursor never chooses its own skill bundle.
- Only steps requiring judgment use AI. Deterministic execution, validation, fingerprinting, policy checks, and report facts remain outside the model.
- All eight workflows must be operational before readiness.
- Project artifacts publish centrally to the Qali repository during the first trial. Customer repositories remain read-only.
- Synthetic `_e2e` publication PRs are verified and closed unmerged.
- Any model may be qualified; unattended live execution requires a qualified Cursor CLI/model/harness combination.
- Agent outages fail closed outside explicit Mock Mode.

Each numbered implementation slice is a separate `codex/*` branch and human-reviewed PR. Dependencies are sequential; no branch is merged automatically.

## Contracts and Configuration

### Trusted project resolution

Add a versioned project registry mapping:

- Project ID to canonical `projects/<id>` root.
- GitHub Environment name.
- Allowed Slack teams, channels, users, and roles.
- Publication repository and branch; initially `hlemmur/qali:main`.
- Enabled workflows and schedules.
- Active execution profile.

The intent classifier returns only intent, project ID, and declarative focus parameters. It cannot choose project roots, GitHub Environments, autonomy, permissions, or publication targets.

Each project gains a machine-readable execution profile defining:

- Environment label: `mock`, `staging`, or `production`.
- Standard target variables:
  - `QALI_TARGET_BASE_URL`
  - `QALI_ALLOWED_ORIGINS_JSON`
  - `QALI_TEST_CREDENTIALS_JSON`
  - `QALI_TEST_DATA_JSON`
- Browser, rate, mutation, cleanup, redaction, and retention policies.
- Review-only publication as the default.

Values and secrets live in the selected GitHub Environment, not committed files.

### Workflow and harness contracts

Replace a step’s single `skill` field with `harnessProfileId`. A harness profile declares:

- Ordered skills.
- Always-on and task-specific policies.
- Required templates.
- Read/write artifact classes.
- Available tools.
- Allowed mutation classes.
- Deterministic validators.
- Timeout and retry policy.
- `runIf`: `success`, `failure`, or `always`.
- Fallback: `mock-only` or `fail-closed`.

Add typed contracts for:

- `AgentHarnessManifest`
- `AgentStepResult`
- `WorkflowAttempt`
- `ModelQualificationRecord`
- `SemanticPublicationManifest`
- `E2ERunEvidence`

A workflow cannot report success unless every required output was created or changed during that attempt and passed its declared validators.

## Implementation Slices

### 1. Project execution profiles

- Add project registry and execution-profile schemas.
- Resolve all trusted project metadata after classification.
- Reject unknown projects, ID/root mismatches, unauthorized Slack scope, missing environments, and unsafe origins.
- Remove demo-specific URL/server behavior from the global Playwright configuration.
- Keep Mock Mode as an explicit profile with a visible badge.

Tests:

- Registry resolution and authorization.
- Missing/malformed variables.
- Cross-project access denial.
- Mock, staging, and production labels using the same interface.
- Project-aware Playwright run against an injected target URL.

### 2. Restricted browser facade

Build a trusted local MCP/browser service exposing only:

- Navigate within allowed origins.
- Accessibility snapshot.
- Role/label-based click and fill.
- Fill a named credential or test-data field without revealing its value.
- Capture screenshot/trace under an evidence ID.
- Read sanitized console and network summaries.

Prohibit arbitrary JavaScript evaluation, unrestricted URLs, raw cookie access, secret retrieval, downloads, and uncontrolled form submission.

Tests:

- Allowed navigation and interaction.
- Origin escape, redirect (document and subresource), popup, download, and credential-exfiltration rejection.
- Traces are refused after named credentials are filled; tracing never stores DOM snapshots.
- Secret values never appear in model-visible context, logs, or evidence indexes.
- Prompt-injection text remains page data.

### 3. Runtime skill assets and harness assembler

- Store full reviewed skills under `skills/runtime/<skill>/SKILL.md`.
- Verify actual source content, license, upstream hash, and security audit where available.
- Build an ephemeral run workspace containing only:
  - Permitted inputs.
  - Writable output directories.
  - Generated runtime `AGENTS.md`.
  - Selected `.agents/skills`.
  - Generated `.cursor/rules`.
  - Required templates.
  - Deny-by-default `.cursor/cli.json`.
  - Browser MCP configuration.
- Do not place all runtime skills in the repository-level `.agents/skills`, preventing unintended global discovery.
- Deny Cursor shell access; deterministic host code runs checks and Playwright.
- Generate the harness manifest outside the model.

Tests:

- Exact workspace contents for every harness profile.
- Unselected skills and unrelated project files are absent.
- Environment allowlist excludes Slack, GitHub, publication, and target credentials.
- Cursor cannot write outside staged outputs.
- Manifest hashes change when a rule, skill, template, or permission changes.

### 4. Correct skill bindings

Use small, step-specific profiles:

| Workflow step              | Required harness                                                           |
| -------------------------- | -------------------------------------------------------------------------- |
| Onboarding discovery       | `qa-project-bootstrap`, `qa-project-context`                               |
| Journey discovery          | `journey-mapping`                                                          |
| Risk assessment            | `risk-based-testing`                                                       |
| Strategy and initial plan  | `qa-start`, `test-strategy`, `test-planning`, `test-data-management`       |
| Exploration charter        | `exploratory-testing`                                                      |
| Browser exploration        | `agentic-browser-testing`, `test-data-management`                          |
| Coverage design            | `risk-based-testing`, `test-planning`                                      |
| Test generation            | `ai-test-generation`, `playwright-automation`, `test-data-management`      |
| Visual scenario generation | Base generation profile plus `visual-testing`                              |
| Failure explanation        | `ai-bug-triage` after deterministic fingerprinting                         |
| Reproduction               | `bug-reproduction`, `playwright-automation`                                |
| Knowledge reconciliation   | `qa-project-context`; add `journey-mapping` only for typed journey changes |
| Reliability diagnosis      | `test-reliability`                                                         |
| Selector repair            | `selector-drift-recovery`, `playwright-automation`                         |
| Human-facing reporting     | `qa-report-humanizer` after deterministic aggregation                      |

Always attach operating-model, evidence/provenance, and authority/autonomy policies. Attach project-knowledge or test-authoring policies by artifact class.

Tests:

- Exact binding matrix.
- No unused selected skill.
- No required skill missing.
- Conditional visual/journey skills selected only from typed inputs.
- Conflicting guardrails or excessive permissions fail validation.
- Real-agent evals verify behavior independently of the model’s claim about which skill it used.

### 5. Model qualification

Create a version-controlled qualification registry keyed by:

- Cursor CLI version.
- Model identifier.
- Harness version.
- Skill/rule/template hashes.
- Evaluation-suite hash.
- Qualification run URL and result.
- Qualification date and 30-day expiry.
- Active or revoked state.

Policy:

- Any model can run in Mock Mode or qualification mode.
- Only qualified combinations run unattended against configured projects.
- Failover uses another qualified combination.
- Otherwise the workflow blocks without placeholder output.
- Any CLI, model, harness, skill, rule, browser facade, or permission change requires requalification.

Implementation assets:

- `qualification/registry.json` is the version-controlled registry. Keep it empty until a dedicated qualification run has passed and supplied an HTTPS run URL.
- `qualification/evaluation-suite.json` is included in the runtime identity hash.
- `npm run qualification:validate` validates registry structure and rejects duplicate runtime identities.
- The shared execute workflow never enables qualification mode. Dedicated qualification tooling may invoke that policy mode per run; normal staging and production runs always fail closed unless the exact CLI/model/runtime hashes have an active, passed, unexpired record.

### 6. Workflow engine reliability

Implement:

- Enforced step timeout and process cancellation.
- Declared retries with persisted attempts.
- Idempotent resume.
- `runIf` continuation after failure.
- Separate workflow outcome from reporting completion.
- Append-only JSONL state with correlation and harness hashes.
- Queue retry for transient failures and dead-letter handling.
- No placeholder-generating live fallback.

A failed Playwright step continues into failure analysis and reporting while the final workflow remains failed.

### 7–14. Make all eight workflows substantive

Implement each workflow in its own focused branch:

1. Project onboarding:
   - Deterministic scaffold.
   - Evidence-backed context, questions, journeys, risks, strategy, and plan.
   - Unknown facts remain unknown.

2. Exploratory testing:
   - Real browser facade usage.
   - Time/step budget.
   - Observations, evidence references, questions, and report.

3. Generate test suite:
   - Approved-scenario and requirement traceability.
   - Generated Playwright code.
   - Deterministic lint, typecheck, and targeted execution.
   - Genuine visual assertions use `toHaveScreenshot()`; evidence-only screenshots remain separately labeled.

4. Run test suite:
   - Project-aware Playwright execution.
   - Accurate counts, evidence, duration, and failure state.
   - No AI in the deterministic execution step.

5. Triage and reproduce:
   - Deterministic failure fingerprint.
   - AI explanation after fingerprinting.
   - Minimal reproduction and regression candidate observed red.

6. Knowledge maintenance:
   - Contradictions retained.
   - Questions opened instead of silent promotion.
   - Confirmation requires validated authority.

7. Suite maintenance:
   - Repeated-run reliability diagnosis.
   - Equivalent selector repair only.
   - Assertion/oracle fingerprint must remain unchanged.

8. Quality pulse:
   - Deterministic aggregation of runs, risks, failures, coverage, and open decisions.
   - AI rewrites presentation only.
   - Command and scheduled paths use the same workflow.

Every workflow PR includes a unified Mock Mode E2E test through the production orchestrator—not a separate demo executor.

### 15. Semantic publication

Classify before/after diffs rather than paths alone.

- Observation publication must be append-only.
- New tests require an approved scenario.
- Modified tests require unchanged assertion/oracle fingerprints.
- Governed-source changes require authority and provenance.
- Derived artifacts require valid generated hashes.
- Reject deletes, skips, assertion weakening, baseline replacement, unrelated source code, and manual check declarations.
- Publication checks contain actual executed commands and results.
- Raw screenshots, traces, videos, cookies, and logs remain outside Git.

Initial real-project policy remains review-only. Auto-merge requires passing live evaluations and a recorded QA Lead decision.

### 16. Privacy and control-plane hardening

- Separate GitHub webhook and Actions callback secrets.
- Add callback timestamp, nonce, replay window, and idempotency.
- Redact secrets, cookies, tokens, sensitive headers, configured PII patterns, and target data.
- Automate D1 retention and artifact retention.
- Add per-user/project rate limits.
- Enforce least-privilege GitHub Environments.
- Pin Actions, Cursor installer/version, and runtime container images.
- Record security-relevant denials without recording sensitive content.

## E2E Strategy

### Automated tools

Use:

- Local shell and Playwright for build, tests, isolated browser runs, and fixture control.
- Qali’s restricted browser MCP for agent exploration.
- Slack connector to send commands and read correlated threads.
- Browser plugin only where Slack connector cannot exercise UI buttons or visible interaction state.
- GitHub connector for PR state, diffs, reviews, branches, and secret scanning.
- Authenticated `gh` for Actions logs, artifacts, environments, secrets, and run watching.
- Cloudflare MCP/API and Wrangler for deployment inventory, Worker versions, D1, Queues, cron triggers, logs, and rollback.

Tooling is attempted first. Manual help is requested only when authentication or an ownership-sensitive UI action cannot be completed through available tools.

### Per-PR gates

Every implementation PR must pass:

1. Focused RED → GREEN behavior test.
2. Full `npm run check`.
3. Unified Mock Mode E2E.
4. Project validation.
5. Security/permission regression tests.
6. Relevant real Cursor replay or qualification test.
7. Clean Git status and secret scan.

### Live release-candidate matrix

After all implementation PRs are merged:

1. Snapshot the current `qali-slack-control` deployment for rollback.
2. Deploy the release candidate.
3. Use private `#test-qali` (`C0BPN1KEHC4`).
4. Run uniquely correlated scenarios:

| Scenario                | Required evidence                                                 |
| ----------------------- | ----------------------------------------------------------------- |
| Onboarding              | Complete governed pack with unknowns/questions preserved          |
| Exploration             | Browser actions, evidence, injection resistance, changed outputs  |
| Generation              | Approved traceability, generated test, deterministic passing run  |
| Passing run             | Exact counts and artifact links in Slack                          |
| Failing run             | Failed outcome plus completed analysis/report                     |
| Triage                  | Stable fingerprint, reproduction, red regression evidence         |
| Knowledge maintenance   | Contradiction retained; no silent promotion                       |
| Suite maintenance       | Equivalent repair with unchanged oracle fingerprint               |
| Quality pulse command   | Evidence-backed summary without fabricated counts                 |
| Scheduled pulse         | One idempotent cron-triggered result; cron configuration restored |
| Developer authorization | Maintenance/governance rejected before dispatch                   |
| QA Lead authorization   | Allowed workflow dispatch                                         |
| Duplicate/replay        | One execution only                                                |
| Agent outage/quota      | Explicit blocked state, no placeholder success                    |
| Unqualified model       | Qualification rejection before target access                      |
| Origin escape           | Browser facade denial                                             |
| Rerun button            | New correlated run                                                |
| Triage button           | Triage run linked to failed source run                            |
| Safe publication        | Real synthetic artifact PR created review-only                    |
| Unsafe publication      | No branch or PR created                                           |
| Redaction               | No seeded secrets/PII in Slack, logs, artifacts, or PR            |

The synthetic artifact PR contains only `_e2e` observations, sanitized indexes, derived artifacts, generated tests, and harness traceability. After verification it is closed unmerged, with its URL retained in the E2E report.

### Release acceptance

Qali is ready for the first actual project only when:

- All existing and new automated tests pass.
- All eight workflows pass substantive-output checks.
- No live workflow can false-green through placeholder or stale outputs.
- At least one Cursor CLI/model combination is qualified.
- Slack, D1, GitHub, harness manifest, workflow state, evidence, and publication correlate by one run ID.
- Failure, timeout, auth, quota, replay, unsafe mutation, and prompt-injection paths fail safely.
- Rollback to the prior Worker deployment is proven.
- Documentation distinguishes `implemented`, `mock-tested`, `qualified`, and `live-verified`.

## Manual Handoffs

Expected user involvement is limited to:

- Completing `gh auth login` when the live GitHub phase begins.
- Supplying or rotating secrets through secure prompts/environment configuration, never chat.
- Approving and merging implementation PRs.
- Clicking Slack controls only if no authenticated browser session is available.
- Reviewing genuine real-project artifact PRs.
- Recording the QA Lead decision if auto-merge is enabled later.

## Assumptions

- Existing Worker, Slack app, `#test-qali`, and GitHub repository are the live test surface.
- No second Slack staging app is required.
- First-trial publication is centralized in the Qali repository.
- Customer repositories remain read-only.
- Raw runtime evidence is retained outside Git.
- Synthetic `_e2e` publication PRs are closed unmerged.
- Real-project publication PRs remain open for human review.
- No implementation branch or PR is merged by the agent.
