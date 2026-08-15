# Exploration Log

> Append-only observations. Observation IDs describe what happened and never define expected behavior.

| ID      | Observation                        | Status  | Evidence | Observed at | Session |
| ------- | ---------------------------------- | ------- | -------- | ----------- | ------- |
| OBS-001 | No exploration has been performed. | unknown | —        | 2026-08-13  | —       |

# QA Session

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
| 01:09      | QUESTION | Attempt browser navigate    | `qali-browser` MCP server configured in `.cursor/mcp.json` but not registered in runtime catalog. `browser_navigate` call failed with "MCP server does not exist".                                                                                   | EVD-EXP-001                                                              |
| 01:09      | QUESTION | Attempt HTTP fetch fallback | Direct fetch to target origin rejected by runtime policy. Shell prohibited by role constraints.                                                                                                                                                      | EVD-EXP-001                                                              |
| 01:09      | IDEA     | Deep login matrix prepared  | Five scenarios queued for live execution: happy path (EXP-LOGIN-001), invalid credentials (EXP-LOGIN-002), locked user (EXP-LOGIN-003), empty submit (EXP-LOGIN-004), a11y control inventory (EXP-LOGIN-005). All verdicts blocked pending browser.  | EVD-EXP-003                                                              |

## Debrief

- Coverage: **partial** — governed-source analysis complete; live login UI and runtime behavior **unexplored** due to environment block.
- Reproduced findings: none (no live session).
- Suspected findings: none recorded without live evidence.
- Non-issues: none confirmed live.
- Knowledge updates:
  - Exploration charter and deep test matrix authored for login flow (EVD-EXP-002, EVD-EXP-003).
  - Environment failure documented when browser MCP unavailable (EVD-EXP-001).
- Open questions:
  - Q-EXP-001: What is the exact error copy for invalid credentials vs locked_out_user on the current build?
  - Q-EXP-002: Does empty-form submit show HTML5 validation, inline error, or silent no-op?
  - Q-EXP-003: What is the post-login URL and page title for DATA-001?
  - Q-EXP-004: Are all login controls exposed in the accessibility tree with stable roles/names matching JRN-001 locators?
  - Q-EXP-005: Why is `qali-browser` absent from the MCP catalog despite `Mcp(qali-browser:*)` allow rule?
- Follow-up: Re-run explore step with `qali-browser` connected; execute EXP-LOGIN-001 through EXP-LOGIN-005; capture snapshots and assert oracles per agentic-browser-testing skill; append evidence-backed observations only.
