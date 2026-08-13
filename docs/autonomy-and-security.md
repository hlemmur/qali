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

| Role                | Enforcement point                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Developer**       | Worker `authorizeCommand()` before dispatch; product channels may onboard/explore/run; blocks maintenance and governance parameters |
| **Ops break-glass** | `#qali-ops` (`SLACK_OPS_CHANNEL_IDS`) plus `SLACK_QA_LEAD_USER_IDS`; maintenance and privileged Slack actions                       |

Map break-glass users via `SLACK_QA_LEAD_USER_IDS`. They are Developers outside `#qali-ops`. Default for all other allowed users: Developer.

## Security controls

- **Signature verification** — Slack `v0` HMAC and GitHub `sha256` webhook HMAC with replay window
- **Allowlists** — team, channel, user IDs optional but recommended
- **Untrusted input** — classifier treats Slack text as data; JSON schema response only
- **Least privilege** — execute job `contents: read`; publication token isolated
- **No direct main push** — all generated changes via `qali/*` PR
- **Path traversal blocked** — publication rejects paths outside `projects/`

### Restricted browser boundary

Agent browser access runs through the local `@qali/browser-facade` MCP service. Its tool surface is deny-by-default: allowlisted navigation, redacted accessibility snapshots, exact role/label interaction, named-value fill, masked evidence capture, and sanitized diagnostics. It exposes no JavaScript evaluation, cookies, downloads, secret reads, or general network client.

The service resolves its target, origins, named credentials/test data, redaction rules, and approved form controls from a validated project execution profile plus environment variables. Form submission is rejected unless the exact role/name is approved; approved forms must use POST (including submitter `formmethod` overrides). Unapproved document POST navigations are blocked even when triggered by page scripts. Redirects are inspected before following for document and subresource requests, and off-origin redirects are blocked before the destination receives a request. Popups and downloads are always denied. Playwright traces are refused after named credentials are filled, and tracing does not retain DOM snapshots.

Named credentials and test data remain inside the service process. Tool results and errors are redacted, screenshots mask fields populated through named fill, and evidence indexes contain artifact references only. Accessibility text and diagnostics are explicitly returned as untrusted page data so page-level prompt injection does not become an instruction.

The stdio service starts with `npm run browser:mcp` and requires:

- `QALI_EXECUTION_PROFILE_PATH`
- the four standard `QALI_TARGET_*` / `QALI_TEST_*` variables declared by that profile
- an absolute `QALI_BROWSER_EVIDENCE_DIR`

An optional `QALI_BROWSER_EXECUTABLE_PATH` selects a trusted browser binary. The service writes protocol messages only to stdout and emits no secret-bearing startup diagnostics.

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
