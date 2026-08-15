# Qali user guide

Qali is a Slack-first QA teammate. You describe what you want tested in plain language; Qali selects a governed workflow, runs it in GitHub Actions, uses Playwright for deterministic checks, preserves evidence, and reports the result back in the same Slack thread.

You do not need to learn Qali's internal agents, skills, workflow files, or command syntax. The normal interface is a conversation:

> `@Qali explore login on sauce-demo`

> `@Qali generate a smoke suite for sauce-demo`

> `@Qali what's our current quality status?`

> `@Qali when is the next scheduled pulse?`

> `@Qali pause all test activities`

> `@Qali run the smoke suite on sauce-demo`

> `@Qali triage the latest failures on sauce-demo`

## Why teams use Qali

Qali turns common QA work into repeatable, reviewable workflows:

- Explore a product with a restricted browser and preserve what was actually observed.
- Turn approved scenarios into Playwright tests with requirement traceability.
- Run suites deterministically and report exact counts, duration, failures, and evidence.
- Triage failures from artifacts instead of guessing from a screenshot or error snippet.
- Diagnose flaky selectors without silently weakening assertions.
- Reconcile project knowledge while preserving contradictions and open questions.
- Produce a concise quality pulse from recorded facts.
- Publish safe generated changes through a review-only pull request rather than pushing directly to `main`.

The core promise is simple: AI can help with judgment and explanation, but Playwright, deterministic validators, policy checks, and review gates decide what is true and what may be published.

## The experience in Slack

### 1. Ask in natural language

Mention Qali in an allowed project channel or send it a direct message. Include the project and the outcome you want. Good requests are short and specific:

- `@Qali onboard https://www.saucedemo.com`
- `@Qali onboard project sauce-demo`
- `@Qali deep testing of checkout`
- `@Qali explore the login journey on sauce-demo`
- `@Qali add tests for this issue`
- `@Qali generate tests for the approved login scenarios on sauce-demo`
- `@Qali run the smoke suite on sauce-demo`
- `@Qali triage the latest sauce-demo failures`
- `@Qali show the quality pulse for sauce-demo`
- `@Qali what's our current quality status?`
- `@Qali when was the latest full regression?`
- `@Qali when is the next scheduled pulse?`
- `@Qali pause all test activities` (ops channel)
- `@Qali schedule full regression for 04:00` (ops channel)

Questions about status, last run, coverage, schedule, expected results, history, or known issues are answered in the same thread from a stored quality snapshot. They do not start Playwright. If Qali has no snapshot yet, it reads the project pack and comes back with the answer. Pause, resume, and “schedule this at 04:00” are ops-channel work; they update `derived/workflow-state/schedule.yaml` and GitHub’s Actions cron list is kept in lockstep with that file.

Qali classifies only the intent, project ID, and a declarative focus. Deep, edge-case, or negative testing becomes exploration with `depth` and `feature` when you name them. It cannot choose a filesystem root, environment, permissions, publication repository, or autonomy mode from your message. Those are trusted project settings.

You can also open the overflow menu on a Slack message and choose **Test with Qali** or **Triage with Qali**. Test starts the project suite with that message as context. Triage needs a Qali run already in the thread.

### 2. Get an immediate acknowledgement

Qali responds in the message thread so it does not flood the channel. Questions are answered directly. Work requests show one updatable status that states the inferred project, environment, and suite, then a plain-language activity:

1. `I'll use sauce-demo, production, smoke.` plus `Checking project and permission`
2. The same message updates to exploring, running, or generating, with elapsed time
3. A queued/running result card
4. A terminal passed, failed, blocked, cancelled, or timed-out result

Open Qali's App Home for a personal control room: needs attention, running, and recent work. The channel stays the team surface.

### 3. Read essentials first

The result card leads with the information developers usually need:

- Workflow and project
- Terminal status
- Passed, failed, skipped, and total test counts when a test suite ran
- A short failure summary
- **Open report** for the hosted execution report: KPIs, pass rate, case table, issues, and failure screenshots when Playwright ran (signed link; no unzipping Markdown)
- GitHub as a fallback for the Actions run and the Playwright HTML artifact (`playwright-report/` in the zip) after a test suite run

Use **Expand** for duration, evidence paths, and detailed errors. Terminal cards also offer **Rerun**; failed test runs offer **Triage**. After generation, **View tests in GitHub** and **Retract** let you keep or remove the tests from that run without a pre-approval step. Retract only deletes generated specs stamped for that generation request.

### 4. Continue from the same thread

Every request carries Slack, D1, GitHub, workflow-state, evidence, and publication correlation. A rerun creates a new correlated run rather than overwriting the original history. Triage links back to the failed source run. Message shortcuts **Test with Qali** and **Triage with Qali** use the same correlation when they run from a Qali thread.

## What each workflow produces

| What you ask for        | What Qali does                                                                                                                                | What you receive                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Onboard project**     | Scaffolds the pack, discovers context/journeys/risks, runs a first bounded explore, writes strategy/plan/scenarios, and seeds `schedule.yaml` | Governed pack, first exploration evidence, schedule seed, hosted HTML recap                                          |
| **Explore project**     | Qualified Cursor agent explores in the assembled `browser-exploration` harness                                                                | Charter, focus-driven session, append-only observations, proposed smoke/regression scenarios, structured Open report |
| **Generate test suite** | Qualified Cursor agent designs coverage from journeys, proposed explore scenarios, and Slack focus, then host-validates Playwright specs      | Coverage map, generated `@smoke`/`@regression` specs, Slack recap with View tests in GitHub and Retract              |
| **Run test suite**      | Runs project-aware Playwright without AI in the execution step                                                                                | Exact counts, scenario list, status, duration, JSON evidence, hosted HTML, Playwright HTML artifact, Slack summary   |
| **Triage failure**      | Fingerprints the failure deterministically, explains it, builds a minimal reproduction, validates that it is red                              | Stable fingerprint, explanation, reproduction evidence, regression candidate, triage report                          |
| **Maintain knowledge**  | Compares evidence with governed knowledge and retains uncertainty                                                                             | Reconciliation proposal, contradictions, open questions, authority-gated updates                                     |
| **Maintain suite**      | Diagnoses reliability and permits only equivalent repairs                                                                                     | Baseline fingerprint, reliability diagnosis, selector-only repair proposal, unchanged assertion/oracle proof         |
| **Quality pulse**       | Aggregates recorded facts before any AI presentation step                                                                                     | Risks, recent runs, failures, coverage, decisions, concise Markdown/Slack presentation                               |

## What Qali will not do silently

Qali is deliberately opinionated about trust:

- It does not push generated changes directly to `main`.
- It does not delete or skip tests to make a run green.
- It does not weaken assertions or silently change expected behavior.
- It does not replace visual baselines without authority.
- It does not turn an observation into product truth without evidence and authority.
- It does not expose target credentials to the agent or browser tool output.
- It does not report a workflow as passed when execution or publication failed.
- Outside explicit Mock Mode, it does not generate placeholder success when the agent runtime is unavailable or unqualified.

## The project pack: what accumulates over time

Each target has a versioned project pack under `projects/<id>/`:

```text
projects/<id>/
├── execution-profile.json
├── sources/          # Governed facts, requirements, journeys, decisions
├── observations/     # What Qali actually observed, with evidence
├── derived/          # Regenerated scenarios, reports, coverage, workflow state
└── tests/            # Approved Playwright specifications
```

The ownership model is `sources → observations → derived artifacts/tests`:

- **Sources** describe expected behavior and authority.
- **Observations** record actual behavior and never silently redefine expectation.
- **Derived artifacts** can be regenerated from sources and observations.
- **Tests** come from journeys and generated scenarios, stay deterministic, and can be retracted from Slack.

This makes Qali more than a chat bot: the Slack conversation is the front door to an auditable QA system that improves its project knowledge and test suite over time.

## Roles and permissions

| Slack surface                   | Typical access                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product channel** (Developer) | Onboard from an https URL, explore, generate/run suites, triage, quality pulse, query. Governance parameters are rejected.                                       |
| **`#qali-ops`**                 | Knowledge and suite maintenance. Only break-glass users in `SLACK_QA_LEAD_USER_IDS` may do this, and only from an ops channel listed in `SLACK_OPS_CHANNEL_IDS`. |

Project-level Slack allowlists can restrict teams, channels, and users. Authorization happens before a GitHub workflow is dispatched. Ask in `#qali-ops` for maintenance; do not treat any person as a user-facing QA Lead.

## Quick setup

### If Qali is already installed for your team

1. Ask the Qali administrator which Slack channel and project ID are enabled.
2. Invite Qali to a private channel if required.
3. Start with `@Qali show the quality pulse for <project>` or `@Qali explore <journey> on <project>`.
4. Follow the result in the thread; use **Expand**, **Rerun**, or **Triage** when available.

### Add a project to an existing Qali installation

In a product channel:

```text
@Qali onboard https://www.example.com
```

Optional named credentials in the same message are written to the GitHub Environment secret and are never echoed in Slack acks. The live Sauce Demo URL maps to the existing `sauce-demo` pack instead of creating a duplicate.

Operators run `npm run operator:install` once. Developers never copy `projects/_template`. `@Qali onboard https://…` scaffolds the pack, upserts `projects/registry.json`, provisions the GitHub Environment, and runs the first bounded exploration. After that, review and approve scenarios before generating tests.

See [Project template](project-template.md), [GitHub setup](setup-github.md), [Slack setup](setup-slack.md), and [Cloudflare setup](setup-cloudflare.md) for operator-level installation.

### Try Qali against Sauce Demo

The live Slack target is Sauce Demo (`https://www.saucedemo.com`, project id `sauce-demo`). In an allowed channel, mention `@Qali` and ask in plain language. Local credential-free fixtures (`projects/_demo`, `npm run demo:loop`) stay in the [developer guide](developer-guide.md); they are not the Slack product path.

## Reading results correctly

Qali uses four different confidence levels:

| Label             | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| **Implemented**   | Code and contracts exist                                                                                 |
| **Mock-tested**   | Behavior passed deterministic local/CI tests in explicit Mock Mode                                       |
| **Qualified**     | An exact model + CLI + harness + permissions identity passed the evaluation suite and is unexpired       |
| **Live-verified** | A uniquely correlated Slack → Worker/D1 → Actions → evidence/publication → Slack run proved the behavior |

A green local test does not prove the live integration, and a Slack “passed” card does not prove substantive artifacts. Ask for the evidence level that matches your decision.

## FAQ

### Where is the Playwright report?

**Open report** is Qali’s hosted execution report (script-free HTML, signed URL on R2). After a **run test suite**, that page is the human results view: KPIs, pass rate, cases with descriptions, durations, issues, and failure screenshots. It is not Playwright’s interactive HTML reporter: that reporter is a JavaScript app, so it cannot be served from R2.

The GitHub Actions zip is forensics, not the user report. Open `report.html` at the zip root for a copy of the same execution report. Open `playwright-report/index.html` locally for traces, the step timeline, and video. `test-results/` holds raw traces and videos. Derived Markdown/JSONL in the zip is machine provenance — do not treat it as the test report.

**View tests in GitHub** (formerly Open spec) opens generated Playwright **source** in the repository. That is not the execution report.

Onboard and quality pulse do not execute Playwright. Explore Open reports describe the charter, coverage, findings, and evidence instead of a case table. Generate tests first, then run the suite, to get the detailed test list.

### Do developers need to learn commands?

No. Qali accepts normal Slack language, plus **Test with Qali** and **Triage with Qali** on an existing message. Specific prompts produce better focus (`deep testing of checkout`, `negative testing of login`), but users do not need to know internal workflow or skill names.

### Does Qali replace a QA engineer?

Qali is the E2E QA teammate: it explores the product, generates and runs Playwright tests, triages failures, and reports evidence. Playwright remains the deterministic execution truth. People still decide product intent when Qali is uncertain, and they can retract generated tests after review. They should not operate the harness.

### Can Qali test a private or authenticated application?

Yes, if its base URL/origins and named credentials are configured in the project's GitHub Environment. Credential values stay inside the restricted browser service and are masked in screenshots and diagnostics.

### Can the AI browse anywhere or run shell commands?

No. Agent steps receive a small reviewed harness and only declared inputs/outputs. Interactive exploration uses a deny-by-default browser facade with allowlisted origins and actions. Shell, Playwright execution, validators, and publication are host responsibilities.

### Does Qali change application source code?

No. QA publication is limited to governed project artifacts and tests. Unrelated application source changes are rejected.

### Will Qali automatically merge generated tests?

The current first-trial policy is review-only. Qali creates a branch and pull request when publication policy passes; a separate code reviewer reviews and may merge. Auto-merge requires later live evaluation and an explicit ops-channel decision.

### What happens when Qali is uncertain?

It records an open question or blocks the workflow. Unknown information should remain unknown rather than being invented.

### What happens when a run fails?

The terminal status stays failed. Reporting and failure-analysis steps may still run so you get useful evidence. Use **Expand** for detail, **Rerun** for a fresh correlated attempt, or **Triage** to start the evidence-driven triage workflow.

### Are screenshots stored in Git?

Raw screenshots, traces, videos, cookies, and logs remain outside Git and are retained as controlled workflow artifacts. Git stores sanitized references and governed text, not raw browser evidence.

### Does Qali support multiple projects?

The contracts and registry are multi-project. Each project has its own root, Slack scope, GitHub Environment, target configuration, policies, and publication settings. The current live Slack target is `sauce-demo`. Additional real-project onboarding still requires a registered pack, GitHub Environment, and completion of the release acceptance matrix.

### Does Qali test preview deployments?

Not automatically today. A project tests the exact configured target URL. Staging or preview environments require an explicit execution profile and recorded policy decision.

### How do we know Qali did what it claims?

Every meaningful run can be correlated across the Slack thread, D1 request record, GitHub Actions run, workflow-state JSONL, harness fingerprint, evidence artifact, validation results, and publication outcome.

### What should we try first in a demo?

Use this sequence:

1. `@Qali onboard https://www.saucedemo.com`
2. `@Qali explore <critical journey> on <id>`
3. Review and approve scenarios
4. `@Qali generate a smoke suite for <id>`
5. `@Qali run the smoke suite on <id>`
6. Introduce a known failure and use **Triage**
7. `@Qali show the quality pulse for <id>`

The sequence demonstrates context, action, evidence, deterministic truth, failure handling, and governance—not just chat responses.
