# Autonomy and security

Qali defaults to maximum autonomy while blocking changes that redefine truth or hide failures.

## Autonomy modes

Configured per project in `sources/autonomy-policy.md`:

| Mode           | Behavior                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| `conservative` | Human approval for most mutations beyond observation                            |
| `balanced`     | Auto-merge safe generated artifacts; gate expected-behavior changes             |
| `autonomous`   | Qali authors sources, runs maintenance, publishes safe changes — human optional |

Modes affect workflow policy gates, not Slack role permissions. A Developer cannot switch modes regardless of project autonomy.

## What auto-merges (controlled publication)

When deterministic checks pass, `@qali/publication` permits:

- Derived reports and formatted documents under `derived/`
- Observation and evidence appends under `observations/` (with `provenanceRef`)
- New or equivalent-repair tests under `tests/` (with `approvedScenarioRef`)
- Governed source updates under `sources/` (with `authorityRef` + `provenanceRef`, excluding `decisions.md` and `autonomy-policy.md`)

## What never auto-merges

| Mutation                    | Reason                            |
| --------------------------- | --------------------------------- |
| `change-expected-behavior`  | Redefines product truth           |
| `promote-to-confirmed`      | Requires authority                |
| `update-visual-baseline`    | Visual regression contract        |
| `weaken-assertion`          | Hides real failures               |
| `delete-test` / `skip-test` | Reduces coverage without approval |
| `modify-source-code`        | Out of scope for QA publication   |

Self-healing produces **equivalent repairs** (selector drift, timing) — not assertion weakening. Repairs are committed and announced in Slack; they are not silent.

## External roles

| Role              | Enforcement point                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Developer**     | Worker `authorizeCommand()` before queue; blocks maintenance intents and governance parameters |
| **QA Lead/Admin** | Full intent access; privileged Slack actions (autonomy, policy, baseline)                      |

Map leads via `SLACK_QA_LEAD_USER_IDS`. Default for all other allowed users: Developer.

## Security controls

- **Signature verification** — Slack `v0` HMAC and GitHub `sha256` webhook HMAC with replay window
- **Allowlists** — team, channel, user IDs optional but recommended
- **Untrusted input** — classifier treats Slack text as data; JSON schema response only
- **Least privilege** — execute job `contents: read`; publication token isolated
- **No direct main push** — all generated changes via `qali/*` PR
- **Path traversal blocked** — publication rejects paths outside `projects/`

## Production-only testing

Target projects currently test **production** only. There is **no preview URL** assumption for PRs. Guardrails:

- Explicit base URL in project context
- Non-production environments require recorded decision before execution
- Smoke scope stays bounded to approved scenarios

## Human-in-the-loop

Humans answer via `sources/questions.md` and `sources/decisions.md`. Qali surfaces open items in reports but does not mark human review as approved without a recorded decision.

Blocking open items stop execution-gated workflows unless a decision explicitly overrides.

## Audit trail

- Workflow state: `derived/workflow-state/*.jsonl`
- Evidence: `observations/evidence/`
- Git: publication PRs with check list
- Slack: correlated thread updates with run links

## Cost awareness

- Cloudflare Worker + Queue + D1 + Workers AI — monitor free tier limits
- GitHub Actions — minutes per workflow; Playwright browser install dominates cold starts
- Cursor CLI — model usage when enabled in CI

See [setup-slack.md](setup-slack.md) for retention guidance on D1 correlation records.
