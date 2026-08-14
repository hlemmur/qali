# Qali implementation and readiness status

**Status date:** 2026-08-14

**Repository state at assessment:** `main` at `43b4b77`, clean and synchronized with `origin/main`

**Full reviewed-main gate:** 47 test files / 309 tests, formatting, lint, TypeScript, registry validation, qualification-registry validation, harness validation, and Worker dry run passed

**Live-readiness automation:** paused by the user until the publication credential is replaced and continuation is requested

## Executive summary

The pre-trial hardening implementation is substantially complete. All 16 planned slices were implemented through isolated TDD branches and independently reviewed pull requests. Two additional defects discovered by live exploration were fixed and independently reviewed:

- Start the registered target server before browser exploration (`#18`).
- Preserve exploration as an append-only observation and keep generated questions out of reviewer-owned sources (`#19`).

Qali is deployed and the live Slack → Cloudflare Worker/D1/Queue → GitHub Actions → evidence → callback → Slack path is working. Live runs have proved honest terminal failure reporting, substantive onboarding/exploration execution, restricted-browser evidence retention, deterministic validation, append-only semantic publication preparation, and hosted HTML reports with Slack **Open report**.

Qali is **not yet ready for the first real customer project** under the acceptance criteria in the hardening plan. The exact agent runtime has not been qualified, safe publication has not completed because the current publication token is invalid, and most of the uniquely correlated live release-candidate matrix remains to be executed.

### Teammate rebuild (in progress)

| Slice                                                         | Evidence level            | Notes                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage-aware Slack cards and user-facing failure copy          | Implemented + unit-tested | Not live-verified until a post-merge Slack run on main                                                                                                                                                                                                                                           |
| Active-project artifact upload glob                           | Implemented + unit-tested | Stops `_template` from appearing in evidence zips                                                                                                                                                                                                                                                |
| Slack app / FAQ copy (Playwright + E2E teammate)              | Implemented + unit-tested | Manifest must be re-uploaded to Slack after merge to be live-verified                                                                                                                                                                                                                            |
| `query-project` + D1 quality snapshot                         | Implemented + unit-tested | Answers status/last-run/coverage/schedule without Playwright; not live-verified                                                                                                                                                                                                                  |
| Sauce Demo live Slack target; Mock Mode off product path      | Implemented + unit-tested | Live registry is `sauce-demo` only; `_demo` remains a Vitest fixture; not live-verified until a post-merge Slack run                                                                                                                                                                             |
| Progressive thread status, App Home, channel affinity         | Implemented + unit-tested | Ack states inferred project/env/suite; Home lists needs-attention/running/recent; re-upload Slack manifest after merge                                                                                                                                                                           |
| Hosted HTML reports + Slack **Open report**                   | Live-verified             | R2 `qali-reports`; Slack **Open report** on quality-pulse run [31752717647](https://github.com/hlemmur/qali/actions/runs/31752717647); signed GET `200` `text/html`; unsigned/expired `401`. Scenario list + Playwright HTML artifact: implemented, not live-verified (needs a `run-test-suite`) |
| Reverse-approval generate + Slack Retract                     | Implemented + unit-tested | Generate from journeys without pre-approved scenarios; tests auto-merge; Retract from the same thread                                                                                                                                                                                            |
| Slack URL onboard, `#qali-ops` maintenance, env secrets       | Implemented + unit-tested | Worker deployed with `SLACK_OPS_CHANNEL_IDS=C0BQ1LXP877`. Product-channel pause rejected. Onboard reused `sauce-demo` then GitHub `403` on Environments. Invite Qali into `#qali-ops`.                                                                                                           |
| Quality pulse on reviewed main                                | Live-verified             | Slack pulse [31787072573](https://github.com/hlemmur/qali/actions/runs/31787072573) passed execution and publication after generated-marker, Prettier, and empty-publication fixes                                                                                                               |
| `schedule.yaml`, pause, generated Actions cron                | Implemented + unit-tested | Project schedule file drives `execute.yml` crons; ops-channel pause/resume/upsert; scheduled Slack notify enabled; not live-verified                                                                                                                                                             |
| Onboard mega-flow (discover + first explore + schedule)       | Implemented + unit-tested | One `onboard-project` workflow now includes first bounded explore and a conservative schedule seed; existing schedules are left in place; not live-verified                                                                                                                                      |
| Focus routing + Slack Test/Triage shortcuts                   | Implemented + unit-tested | Work intents keep `focus.depth` / `focus.feature`; exploration charters use them. Message shortcuts **Test with Qali** / **Triage with Qali** require a Slack manifest re-upload; not live-verified                                                                                              |
| Host explore/generate on production (no empty-registry block) | Implemented + unit-tested | Explore and generate use host Playwright instead of an unqualified Cursor CLI; Sauce Demo login journey carries a named-fill scenario so generate can emit and execute a spec                                                                                                                    |

## Readiness vocabulary

| Level             | Definition                                                                                                                       | Current interpretation                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Implemented**   | Code, contracts, and policies exist                                                                                              | All 16 hardening slices implemented                                             |
| **Mock-tested**   | Deterministic behavior passed through explicit Mock Mode and production orchestrator paths                                       | Workflows have automated coverage on reviewed main                              |
| **Qualified**     | Exact CLI/model/harness/permission/evaluation identity has a passed, active, unexpired registry record                           | **Not achieved**; `qualification/registry.json` has zero records                |
| **Live-verified** | A unique correlation proves Slack, D1, GitHub, harness, artifacts, validation, publication, and terminal status for the scenario | Partial; onboarding and exploration plus several safety behaviors have evidence |

## What is complete

### Hardening slices 1–16

| Slice                               | Outcome                                                                                                                 | Status                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Project execution profiles       | Trusted registry, Slack scope, GitHub Environment, target configuration, active profile                                 | Implemented + mock-tested                                   |
| 2. Restricted browser facade        | Allowlisted navigation/actions, named values, redaction, evidence, redirect/form/popup/download defenses                | Implemented + mock-tested; core live browser path verified  |
| 3. Runtime skills/harness assembler | Reviewed pinned skills, minimal staged workspaces, read-only boundaries, environment allowlist, manifest                | Implemented + mock-tested                                   |
| 4. Correct skill bindings           | Exact step → harness profile matrix, conditional variants, validation                                                   | Implemented + mock-tested                                   |
| 5. Model qualification              | Runtime identity, registry schema, expiry/revocation/exact-match gate                                                   | Implemented + mock-tested; no qualified record yet          |
| 6. Workflow reliability             | Timeouts, cancellation, attempts, retries, resume, `runIf`, JSONL state, honest outcomes                                | Implemented + mock-tested                                   |
| 7. Project onboarding               | Context, journeys, risks, unknowns/questions, strategy, plan, scenario proposal                                         | Implemented + mock-tested; execution live-verified          |
| 8. Exploratory testing              | Restricted browser, budgets, observations, evidence, questions, report                                                  | Implemented + mock-tested; execution/evidence live-verified |
| 9. Generate test suite              | Approved traceability, Playwright code, deterministic validation, visual assertion distinction                          | Implemented + mock-tested                                   |
| 10. Run test suite                  | Project-aware Playwright, exact counts/duration/evidence, deterministic execution                                       | Implemented + mock-tested                                   |
| 11. Triage/reproduce                | Fingerprint, explanation, minimal reproduction, red validation                                                          | Implemented + mock-tested                                   |
| 12. Knowledge maintenance           | Contradictions/questions, authority-gated confirmation                                                                  | Implemented + mock-tested                                   |
| 13. Suite maintenance               | Reliability diagnosis, equivalent repair, oracle fingerprint protection                                                 | Implemented + mock-tested                                   |
| 14. Quality pulse                   | Deterministic facts, presentation-only AI, command/schedule parity                                                      | Implemented + mock-tested                                   |
| 15. Semantic publication            | Before/after classification, append-only observations, scenario/oracle/authority/generated-hash gates                   | Implemented + mock-tested; preparation live-verified        |
| 16. Privacy/control plane           | Separate secrets, replay/idempotency, redaction, retention, rate limits, environments, pinned dependencies, safe audits | Implemented + mock-tested; selected controls live-verified  |

### Independently reviewed implementation history

The hardening series landed through PRs `#3`–`#19`. The most recent reviewed commits are:

- `c3fe58a` — privacy and control-plane boundaries (`#16`)
- `ddad429` — live E2E readiness safeguards and honest terminal reporting (`#17`)
- `35826aa` — start target server for exploration (`#18`)
- `43b4b77` — append-only exploration publication (`#19`)

Each implementation PR was opened ready for review. The authoring agent did not review, approve, or merge its own PRs.

### Current reviewed deployment

- Worker deployment: `3804f7fc-c80e-419d-a9bb-8c3bae9c2246`
- Worker version: `47b8bfbe-e4ed-413a-ba22-0923b3d8a6c8`
- Immediate rollback deployment: `321125e5-d15b-4f8b-b53f-bbb015faa456`
- Immediate rollback version: `e0ad3d0b-21b4-4335-a72e-b21538faa357`
- Original pre-release rollback retained in operating history: `b18e27af-f64e-4377-aaea-02fc320fe951`

Rollback IDs have been preserved, but an actual rollback-and-restore exercise is still required by release acceptance.

## Live evidence completed

### 1. Onboarding and false-green prevention

**Correlation:** `rc-20260813-1401-onboarding`

- Slack thread: `1786629647.101379` in private `#test-qali`
- Request: `Ev0BPXAV1613`
- GitHub run: [31707923471](https://github.com/hlemmur/qali/actions/runs/31707923471)
- Artifact: `9184036839`, `qali-31707923471-1`, retained until 2026-08-27

Evidence established:

- Slack intake, Worker/D1 correlation, GitHub dispatch, Actions execution, artifact upload, callback, and Slack update are connected.
- Onboarding execution produced substantive governed outputs.
- Governed-source publication was rejected by policy rather than silently pushed.
- The notification job reported terminal failure in Slack and D1; publication failure did not false-green the run.

This is live proof of orchestration, substantive execution, policy enforcement, and honest failure—not successful publication.

### 2. Restricted-browser target lifecycle

**First exploration:** GitHub run [31708679231](https://github.com/hlemmur/qali/actions/runs/31708679231)

- Failed honestly with `ECONNREFUSED 127.0.0.1:4173`.
- Root cause was a real repository defect: the production exploration route did not start the registered project server.
- Fixed with TDD and independent review in PR `#18`.

### 3. Exploration execution and evidence retention

**Correlation:** `rc-20260813-1430-exploration`

- Slack thread: `1786631462.349409`
- Request: `Ev0BQ173MGRY`
- GitHub run: [31710636826](https://github.com/hlemmur/qali/actions/runs/31710636826)
- Artifact: `9185143794`, `qali-31710636826-1`, retained until 2026-08-27

Evidence established:

- Registered target server started successfully.
- Restricted browser navigation, accessibility snapshot, screenshot capture, and diagnostics completed.
- All three exploration workflow steps succeeded.
- Session JSON, screenshot, report, workflow-state JSONL, and manifest were retained.
- Publication correctly rejected a non-append-only observation replacement.

The publication rejection exposed a repository defect rather than a policy defect. It was fixed with TDD and independent review in PR `#19`.

### 4. Append-only exploration preparation

**Correlation:** `rc-20260813-1502-exploration`

- Slack thread: `1786633330.741059`
- Request: `Ev0BPL5JF45D`
- GitHub run: [31713259513](https://github.com/hlemmur/qali/actions/runs/31713259513)
- Artifact: `9186218418`, `qali-31713259513-1`, retained until 2026-08-27

Evidence established:

- Exploration execution succeeded on reviewed commit `43b4b77`.
- Formatting, lint, TypeScript, and project validation checks all returned exit code `0`.
- The semantic manifest contained only `projects/_demo/observations/exploration.md`.
- The change was classified as an observation and carried workflow provenance.
- Prior observation content was preserved as an exact prefix.
- Reviewer-owned `sources/questions.md` was not changed.
- Slack correctly reported terminal failure when the later publication job failed.

Publication did not reach branch/PR creation because the configured publication token returned GitHub `401 Bad credentials`.

### 5. Hosted HTML reports and Slack Open report

**Correlation:** Slack quality-pulse on `sauce-demo` after R2 was enabled

- Slack thread: `1786662494.472389` in private `#test-qali` ([permalink](https://radicalcreation.slack.com/archives/C0BPN1KEHC4/p1786662494472389))
- Request: `Ev0BPYUACBAP`
- GitHub run: [31752717647](https://github.com/hlemmur/qali/actions/runs/31752717647) — `failure`
- Worker version at verification: `198bafcb-8a4b-4d39-bfeb-5fb33ad675dd` with `REPORTS` bound to `qali-reports`
- Terminal card: `1786662505.457169` ([permalink](https://radicalcreation.slack.com/archives/C0BPN1KEHC4/p1786662505457169?thread_ts=1786662494.472389&cid=C0BPN1KEHC4))

Evidence established:

- `notify-slack` posted a terminal card with an **Open report** button (`reportUrl` present).
- Object `sauce-demo/31752717647.html` was stored in R2 and served as a self-contained HTML recap (`<!DOCTYPE html>`, title `Qali · quality-pulse · sauce-demo · failed`, no `<script>`).
- Signed Worker GET returned HTTP `200` with `content-type: text/html; charset=utf-8`.
- Unsigned GET and expired-signature GET returned HTTP `401` `Unauthorized`.

This live-verifies hosted HTML serving and Slack **Open report**. It does **not** live-verify the quality-pulse workflow: `validate-and-execute` failed on `invalid-generated-marker` for `derived/reports/quality-pulse-presentation.json`, so the production orchestrator step was skipped.

## Current blocker

`QALI_PUBLISH_GITHUB_TOKEN` is non-empty locally and in the `qali-publication` GitHub Environment, but the locally stored value also returns GitHub HTTP `401`. Synchronizing the same value would not help.

User action required before continuation:

1. Create or rotate a narrowly scoped GitHub token with the repository contents/pull-request permissions required by the publication adapter.
2. Replace `QALI_PUBLISH_GITHUB_TOKEN` in local `.env` without sharing it in chat.
3. Tell the operator/automation to continue.

On continuation, the safe sequence is:

1. Validate the token with a read-only GitHub API request while printing only status.
2. Synchronize only `QALI_PUBLISH_GITHUB_TOKEN` to the `qali-publication` Environment.
3. Verify secret names/status only.
4. Rerun exploration with a new unique correlation.
5. Confirm a review-only synthetic publication PR is created, inspect it, and close it unmerged after evidence capture.

## Partly implemented or not yet proven

### Model qualification

The qualification mechanism is implemented, but `qualification/registry.json` contains zero records. Therefore:

- Mock Mode and qualification-mode behavior are testable.
- No exact Cursor CLI/model/harness combination is approved for unattended staging/production execution.
- Live `_demo` fixture runs prove the Mock Mode production route and infrastructure, not qualified model behavior.
- Live `sauce-demo` Slack runs on a production profile are not qualified until an exact identity is recorded.

Required: run the dedicated evaluation suite, record the HTTPS run URL, create an active unexpired record, and prove rejection after an identity-changing asset update.

### Safe publication

Semantic preparation is live-verified, but branch/commit/ready-PR creation is not complete in the reviewed release because of the invalid token.

Required: successful synthetic review-only PR creation with only allowed artifacts, independent inspection, URL retention, and closure without merge.

### Live workflow breadth

Onboarding and exploration have substantive live evidence. The following are implemented and mock-tested but not yet live-verified through the complete cross-system chain:

- Generate test suite
- Passing run-test-suite
- Failing run-test-suite with analysis/report continuation
- Triage and reproduce
- Knowledge maintenance
- Suite maintenance
- Quality pulse command
- Scheduled quality pulse

### Live safety matrix

The following hardening behaviors have automated tests, but the release plan requires live correlated evidence:

- Developer authorization denial before dispatch
- `#qali-ops` break-glass maintenance authorization
- Duplicate/replay produces one execution
- Agent outage/quota produces blocked state without placeholder output
- Unqualified model rejected before target access
- Origin escape/browser denial
- Rerun button creates a new correlation
- Triage button links to the failed source run
- Unsafe publication creates no branch/PR
- Seeded secret/PII redaction across Slack, logs, artifacts, and PR
- D1 retention execution
- Scheduled pulse idempotency and cron restoration
- Rollback and restoration

## Release-candidate matrix

| Scenario                    | Implemented | Mock-tested |        Qualified        | Live-verified | Notes                                                                        |
| --------------------------- | :---------: | :---------: | :---------------------: | :-----------: | ---------------------------------------------------------------------------- |
| Onboarding                  |     Yes     |     Yes     |  N/A for host fallback  |    Partial    | Execution/policy/honest failure verified; publication not successful         |
| Exploration                 |     Yes     |     Yes     |  N/A for Mock profile   |    Partial    | Browser/evidence/append-only manifest verified; publication blocked by token |
| Generation                  |     Yes     |     Yes     |           No            |      No       | Awaiting live run                                                            |
| Passing suite               |     Yes     |     Yes     | N/A for host execution  |      No       | Awaiting live run                                                            |
| Failing suite + report      |     Yes     |     Yes     |  Partial AI dependency  |      No       | Awaiting live run                                                            |
| Triage/reproduce            |     Yes     |     Yes     |           No            |      No       | Awaiting live run                                                            |
| Knowledge maintenance       |     Yes     |     Yes     |           No            |      No       | Awaiting live run                                                            |
| Suite maintenance           |     Yes     |     Yes     |           No            |      No       | Awaiting live run                                                            |
| Quality pulse command       |     Yes     |     Yes     | Presentation may use AI |      No       | Live Slack run failed before orchestrator; hosted HTML still served          |
| Scheduled pulse             |     Yes     |     Yes     | Presentation may use AI |      No       | Existing schedule present; release evidence pending                          |
| Hosted HTML Open report     |     Yes     |     Yes     |           N/A           |      Yes      | Signed GET 200 HTML; unsigned/expired 401; Slack Open report present         |
| Honest publication failure  |     Yes     |     Yes     |           N/A           |      Yes      | Slack/D1 false-green prevention verified                                     |
| Safe publication PR         |     Yes     |     Yes     |           N/A           |      No       | Blocked by invalid token                                                     |
| Restricted browser evidence |     Yes     |     Yes     |           N/A           |      Yes      | Live screenshot/session/diagnostic artifact retained                         |
| Model qualification gate    |     Yes     |     Yes     |           No            |      No       | Registry empty                                                               |
| Privacy/replay/rate limits  |     Yes     |     Yes     |           N/A           |    Partial    | Full live adversarial matrix pending                                         |

## What remains before the first real project

1. Rotate and synchronize the publication token.
2. Complete a safe synthetic review-only publication PR and close it unmerged.
3. Qualify at least one exact Cursor CLI/model/harness identity.
4. Run the remaining workflow scenarios with unique correlations.
5. Execute the authorization, replay, outage, qualification, origin, button, unsafe-publication, and redaction scenarios.
6. Prove rollback and restore the reviewed release.
7. Produce one final evidence report correlating Slack, D1, GitHub, harness, workflow state, artifacts, validation, publication, and terminal status.
8. Reconcile older docs that still claim Qali is undeployed or imply default auto-merge.
9. Apply the Slack-native UX improvements prioritized in [Slack agent UX review](slack-agent-ux-review.md).

## Product readiness judgment

### Ready now

- Internal demos explicitly labeled Mock Mode
- Engineering review of the architecture, workflow catalog, harness, and security controls
- Continued live release-candidate testing in private `#test-qali`
- Pitching the intended developer experience with a transparent readiness caveat

### Not ready yet

- Unattended QA against a real customer production target
- Claims of a qualified live AI agent
- Claims that all eight workflows are live-verified
- Automatic merging of generated artifacts
- Marketplace/general customer distribution

## Source documents

- [Pre-trial hardening plan](pre-trial-hardening-plan.md)
- [Developer guide](developer-guide.md)
- [User guide](user-guide.md)
- [Architecture](architecture.md)
- [Runtime harness](runtime-harness.md)
- [Autonomy and security](autonomy-and-security.md)
