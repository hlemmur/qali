# Exploration Log

> Append-only observations. Observation IDs describe what happened and never define expected behavior.

| ID      | Observation                        | Status  | Evidence | Observed at | Session |
| ------- | ---------------------------------- | ------- | -------- | ----------- | ------- |
| OBS-001 | No exploration has been performed. | unknown | —        | 2026-08-13  | —       |

# QA Session — Ev0BPYCU3C4X

- Project: sauce-demo
- Target / environment: `https://www.saucedemo.com` (public production demo; CTX-002, CTX-006)
- Date: 2026-08-15
- Operator / tool: Explorer / Cursor agent (browser-exploration profile)
- Charter: Explore the **login flow** deeply to document UI structure, happy-path sign-in, credential validation, locked-account handling, and adjacent navigation on the public Sauce Demo storefront.
- Account / role: `standard_user` (DATA-001) for happy path; additional public demo personas for negative and locked scenarios when browser access is available
- Mock mode: off (no local mock; CTX-006)

## Charter scope (deep)

| Area                | Intent                                                                                       | Requirement link |
| ------------------- | -------------------------------------------------------------------------------------------- | ---------------- |
| Login UI            | Capture fields, labels, buttons, error regions, and any credential hints on the landing page | REQ-001          |
| Happy path          | Sign in with DATA-001 / DATA-002 and confirm inventory is reachable                          | REQ-001, JRN-001 |
| Invalid credentials | Wrong password and empty-field submission; confirm inventory is not shown                    | REQ-003          |
| Locked account      | Attempt `locked_out_user` (public demo persona) and confirm blocked access                   | REQ-003          |
| Nearby navigation   | Note links or controls visible before authentication (e.g. footer, docs)                     | —                |

## Observations

| Time (UTC)        | Tag      | Action                      | Observation                                                                                                                                                                                                                                              | Evidence                                                                     |
| ----------------- | -------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2026-08-15T00:51Z | NOTE     | Read governed sources       | Product target is `https://www.saucedemo.com`. First live proof goal is login → inventory → cart on Chromium (CTX-007). Happy-path username is `standard_user` (DATA-001); password is a named credential reference (DATA-002), not echoed here.         | `inputs/project-context/project-context.md`, `inputs/reference/test-data.md` |
| 2026-08-15T00:51Z | NOTE     | Read journey JRN-001        | Expected happy path: open login page → fill Username → fill Password → click Login → inventory visible (Add to cart button). Status: **inferred** from source, not live-verified this session.                                                           | `inputs/reference/journeys.md`                                               |
| 2026-08-15T00:51Z | NOTE     | Read requirements           | REQ-001 (sign-in reaches inventory), REQ-003 (invalid/locked accounts do not reach inventory) are **inferred**; no confirmed live proof in this run.                                                                                                     | `inputs/reference/requirements.md`                                           |
| 2026-08-15T00:52Z | RISK     | Environment check           | `qali-browser` MCP server is configured in `.cursor/mcp.json` but is **not registered** in the active harness session (`GetMcpTools` / `CallMcpTool` report server unavailable). Live navigation, snapshot, and screenshot evidence cannot be collected. | —                                                                            |
| 2026-08-15T00:52Z | QUESTION | Blocked live probes         | What exact error copy and DOM role appear for invalid credentials vs locked account? Requires live `browser_snapshot` after submit.                                                                                                                      | —                                                                            |
| 2026-08-15T00:52Z | IDEA     | Negative oracle (REQ-003)   | When browser is available: after failed login, assert URL still on login route, snapshot lacks `Add to cart`, and alert/error text is present; forbidden state is inventory URL or cart controls.                                                        | —                                                                            |
| 2026-08-15T00:52Z | IDEA     | Happy-path oracle (REQ-001) | When browser is available: after DATA-001 login, URL is inventory route, snapshot contains `Add to cart` (first product), and login form is absent.                                                                                                      | —                                                                            |

Tags: `BUG`, `QUESTION`, `IDEA`, `RISK`, `NOTE`.

## Debrief

- Coverage: **blocked** — governed-source review complete; live login-flow exploration not executed because browser tool is unavailable.
- Reproduced findings: none (no live session).
- Suspected findings: none promoted without evidence.
- Non-issues: known-issues register contains no recorded defects (BUG-001).
- Knowledge updates: session recorded environment blocker and deep charter probe plan for retry when `qali-browser` is online.
- Open questions:
  - Q-EXP-001: What is the exact post-login URL pattern for `standard_user`?
  - Q-EXP-002: What error message and accessibility role are shown for invalid credentials?
  - Q-EXP-003: Does `locked_out_user` show a distinct message from generic invalid login?
  - Q-EXP-004: Are there pre-auth navigation links that leave the login surface?
- Follow-up: Re-run explore with `qali-browser` MCP active; capture snapshots and screenshots per probe; do not cite unpublished harness evidence paths.

# QA Session — Ev0BQDQNBWFL

- Project: sauce-demo
- Target / environment: https://www.saucedemo.com (public production demo, CTX-006)
- Date: 2026-08-15
- Operator / tool: Explorer / qali-browser (unavailable)
- Charter: Explore Sauce Demo login flow with named demo credentials and reference journeys to discover login UI structure, authentication outcomes, error handling, and the transition to product inventory.
- Account / role: DATA-001 (happy path), locked_out_user and synthetic invalids for negative paths
- Mock mode: off

## Observations

| Time (UTC) | Tag      | Action                      | Observation                                                                                                                                                                                                                                          | Evidence                                                                 |
| ---------- | -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 01:09      | NOTE     | Read governed sources       | Target is public Sauce Demo at `https://www.saucedemo.com` (CTX-002). Login is username/password form (CTX-003). Happy-path username is DATA-001 (`standard_user`). Password is DATA-002 via named credential reference — not echoed here (CTX-011). | inputs/project-context/project-context.md, inputs/reference/test-data.md |
| 01:09      | NOTE     | Map requirements            | REQ-001 expects named demo sign-in to reach inventory. REQ-003 expects invalid or locked accounts to be blocked from inventory. Both are `inferred` pending live confirmation.                                                                       | inputs/reference/requirements.md                                         |
| 01:09      | NOTE     | Map journey                 | JRN-001 defines login steps: open login page, fill username, fill password, submit Login; success oracle is visible inventory with Add to cart control. Includes Playwright action sketch.                                                           | inputs/reference/journeys.md                                             |
| 01:09      | RISK     | Review risks                | RSK-001: public demo may change without notice. RSK-002: credential leakage into traces. RSK-003: shared demo state not isolated per run. All relevant to login exploration evidence handling.                                                       | inputs/reference/risks.md                                                |
| 01:09      | NOTE     | Known issues baseline       | BUG-001 records no known issues; login exploration did not add evidence-backed defects.                                                                                                                                                              | inputs/known-issues/known-issues.md                                      |
| 01:09      | QUESTION | Attempt browser navigate    | `qali-browser` MCP server configured in `.cursor/mcp.json` but not registered in runtime catalog. `browser_navigate` call failed with "MCP server does not exist".                                                                                   | —                                                                        |
| 01:09      | QUESTION | Attempt HTTP fetch fallback | Direct fetch to target origin rejected by runtime policy. Shell prohibited by role constraints.                                                                                                                                                      | —                                                                        |
| 01:09      | IDEA     | Deep login matrix prepared  | Five scenarios queued for live execution: happy path (EXP-LOGIN-001), invalid credentials (EXP-LOGIN-002), locked user (EXP-LOGIN-003), empty submit (EXP-LOGIN-004), a11y control inventory (EXP-LOGIN-005). All verdicts blocked pending browser.  | `observations/Ev0BQDQNBWFL-login-flow-charter.md`                        |

## Debrief

- Coverage: **partial** — governed-source analysis complete; live login UI and runtime behavior **unexplored** due to environment block.
- Reproduced findings: none (no live session).
- Suspected findings: none recorded without live evidence.
- Non-issues: none confirmed live.
- Knowledge updates:
  - Exploration charter authored for login flow (`observations/Ev0BQDQNBWFL-login-flow-charter.md`).
  - Environment failure documented when browser MCP unavailable (no published evidence artifact).
- Open questions:
  - Q-EXP-001: What is the exact error copy for invalid credentials vs locked_out_user on the current build?
  - Q-EXP-002: Does empty-form submit show HTML5 validation, inline error, or silent no-op?
  - Q-EXP-003: What is the post-login URL and page title for DATA-001?
  - Q-EXP-004: Are all login controls exposed in the accessibility tree with stable roles/names matching JRN-001 locators?
  - Q-EXP-005: Why is `qali-browser` absent from the MCP catalog despite `Mcp(qali-browser:*)` allow rule?
- Follow-up: Re-run explore step with `qali-browser` connected; execute EXP-LOGIN-001 through EXP-LOGIN-005; capture snapshots and assert oracles per agentic-browser-testing skill; append evidence-backed observations only.
