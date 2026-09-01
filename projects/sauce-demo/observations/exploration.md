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

# QA Session — Ev0BQ09LSL6B

- Project: sauce-demo
- Target / environment: https://www.saucedemo.com (public production demo)
- Date: 2026-08-15
- Operator / tool: Explorer / qali-browser MCP
- Charter: Explore Sauce Demo login, inventory, cart, and checkout flows with named demo credentials and heuristic probes via the restricted browser facade to discover requirement gaps, auth boundaries, and unexpected behaviors.
- Focus: app (login → inventory → cart → checkout)
- Method: bounded black-box exploration through the restricted browser facade
- Account / role: DATA-001 (`standard_user`) — intended; not reached due to fill blocker
- Mock mode: off

## Observations

| Time (UTC) | Tag      | Action                                              | Observation                                                                                                                                                                                    | Evidence |
| ---------- | -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 14:39      | NOTE     | Navigate to `/`                                     | Login page loaded with title text "Swag Labs", Username and Password textboxes, Login button, and on-page demo account hints (usernames redacted in snapshot).                                 | —        |
| 14:40      | NOTE     | Snapshot login page                                 | Accessibility tree exposes fields as `textbox "Username"` and `textbox "Password"`; no separate navigation chrome visible pre-auth.                                                            | —        |
| 14:40      | RISK     | Attempt `browser_fill_named` (username, testData)   | Tool timed out waiting for `getByLabel('Username')`. JRN-001 step blocked before submit. Relates to RSK-001 (external demo) and harness locator strategy.                                      | —        |
| 14:40      | RISK     | Attempt `browser_fill_named` (password, credential) | Same timeout on `getByLabel('Password')`. Named credential path untested this session. Relates to RSK-002 (credential handling unverified in UI).                                              | —        |
| 14:41      | RISK     | Attempt `browser_fill` (Username, standard_user)    | Identical `getByLabel` timeout. Suggests login inputs are named via placeholder/accessibility name, not associated `<label>` elements.                                                         | —        |
| 14:41      | NOTE     | Click Login (empty fields)                          | Browser policy rejected interaction: "Form submissions must use POST". Empty-submit error messaging not observed.                                                                              | —        |
| 14:41      | NOTE     | Click Username textbox                              | Browser policy rejected: "Form submission is not allowed". Focus/interaction on inputs may be constrained by facade policy.                                                                    | —        |
| 14:42      | NOTE     | Navigate to `/inventory.html`                       | Redirected back to `/` (login). Unauthenticated deep-link correctly blocked per REQ-003 intent.                                                                                                | —        |
| 14:42      | NOTE     | Diagnostics                                         | Page GET 200; CSS/JS loaded. Console shows blocked font and Backtrace telemetry requests (`ERR_BLOCKED_BY_CLIENT`). No app-breaking network failures observed on login shell.                  | —        |
| 14:42      | QUESTION | Fill locator mismatch                               | Journeys reference `placeholder` locators for Username/Password, but MCP fill tools use `getByLabel`. Is facade configuration expected to map placeholder names to fill labels for Sauce Demo? | —        |
| 14:42      | QUESTION | Credential availability                             | Were `QALI_TEST_DATA_JSON` / `QALI_TEST_CREDENTIALS_JSON` loaded into this harness browser.env? Fill failures appear locator-related, not auth-related, but credentials were not exercised.    | —        |
| 14:43      | IDEA     | Follow-up charter                                   | Once fill works, run locked_out_user and problem_user negative paths (REQ-003), then JRN-002 cart flow and checkout boundary probes (zero items, back navigation).                             | —        |

## Debrief

- Coverage: **partial**
  - Login shell / orient: **covered**
  - Authenticated inventory: **unexplored** (blocked)
  - Cart and checkout: **unexplored** (blocked)
  - Invalid/locked accounts (REQ-003): **unexplored** (blocked)
- Reproduced findings: Login page renders; unauthenticated inventory URL redirects to login; fill tools consistently timeout on Username/Password fields.
- Suspected findings: Harness `browser_fill` / `browser_fill_named` locator strategy may be incompatible with Sauce Demo login field markup (placeholder-based names vs label association).
- Non-issues: Public demo origin reachable (HTTP 200); blocked third-party telemetry/fonts appear environmental, not storefront defects.
- Knowledge updates: First live observation confirms CTX-002 URL and login shell structure; REQ-001/REQ-002 remain **inferred**, not live-verified this session.
- Open questions: See QUESTION rows above; credential config and fill locator mapping need harness confirmation before inventory exploration can proceed.
- Follow-up: Re-run exploration after fill locator fix or placeholder-aware fill support; prioritize JRN-001 happy path, then REQ-003 locked account, then cart/checkout heuristics.

# QA Session — Ev0BQ2SCLWVD

- Project: sauce-demo
- Target / environment: https://www.saucedemo.com (public production demo)
- Date: 2026-08-16
- Operator / tool: Explorer / qali-browser MCP
- Charter: Explore Sauce Demo storefront (login, inventory, cart, checkout) with named demo credentials and bounded browser facade to discover requirement gaps, auth-guard behavior, and unexpected behaviors
- Focus: app — end-to-end shopper flows from login through checkout
- Method: bounded black-box exploration through the restricted browser facade
- Account / role: DATA-001 (`standard_user`) — intended; not reached due to fill tooling mismatch
- Mock mode: off

## Observations

| Time (UTC) | Tag      | Action                                                                 | Observation                                                                                                                                                                                                                                                           | Evidence |
| ---------- | -------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 10:47      | NOTE     | Navigate to `/`                                                        | Login page renders with brand text "Swag Labs", Username and Password textboxes, Login button, and helper copy listing accepted usernames and shared password hint (values redacted in snapshot).                                                                     | —        |
| 10:48      | RISK     | Attempt `browser_fill_named` / `browser_fill` on Username and Password | Both fill tools time out waiting for `getByLabel('Username'/'Password')`. Snapshot shows fields as textbox names (placeholder-style), not labels. JRN-001 expects `placeholder` locator strategy. Authenticated flows blocked for this session.                       | —        |
| 10:49      | RISK     | Click Login button with empty fields                                   | `browser_click` rejected: "Form submissions must use POST". Cannot exercise empty-submit or credential validation via facade.                                                                                                                                         | —        |
| 10:49      | NOTE     | Navigate to `/inventory.html` while logged out                         | SPA redirects to login (`/`). Error banner: "Epic sadface: You can only access '/inventory.html' when you are logged in." Consistent with REQ-003 intent (unauthenticated users do not reach inventory). Network shows 404 on `.html` path before client redirect.    | —        |
| 10:50      | NOTE     | Navigate to `/cart.html` while logged out                              | Same redirect pattern with message referencing `/cart.html`. Auth guard observed on cart route.                                                                                                                                                                       | —        |
| 10:50      | NOTE     | Navigate to `/checkout-step-one.html` while logged out                 | Same redirect pattern with message referencing `/checkout-step-one.html`. Auth guard observed on checkout route.                                                                                                                                                      | —        |
| 10:51      | QUESTION | Error banner dismiss control                                           | Snapshot shows an unnamed `button` inside the error heading; clicks on "Close" / "×" did not resolve. Unclear accessible name for dismiss control — accessibility review warranted.                                                                                   | —        |
| 10:51      | RISK     | Console / network diagnostics                                          | Repeated `ERR_BLOCKED_BY_CLIENT` on inspector/analytics endpoints; Google Fonts blocked. Core app assets (`index-*.css`, `index-*.js`) load 200. Telemetry to `events.backtrace.io` blocked. Unlikely to block core flows but may hide real-world telemetry failures. | —        |
| 10:51      | IDEA     | Follow-up charter                                                      | After facade supports placeholder fills and POST login, run: (1) JRN-001 happy path, (2) `locked_out_user` negative per REQ-003, (3) add-to-cart JRN-002, (4) checkout boundary values.                                                                               | —        |

Tags: `BUG`, `QUESTION`, `IDEA`, `RISK`, `NOTE`.

## Debrief

- Coverage:
  - Login landing UI: **partial** (rendered; submit and credential paths not exercised)
  - Unauthenticated deep-link guards (inventory, cart, checkout): **covered**
  - Authenticated inventory / cart / checkout: **unexplored** (tooling blocker)
  - Invalid / locked account handling: **unexplored** (tooling blocker)
- Reproduced findings:
  - Unauthenticated access to `/inventory.html`, `/cart.html`, and `/checkout-step-one.html` redirects to login with route-specific "Epic sadface" messages (observed 2026-08-16).
  - `browser_fill` / `browser_fill_named` cannot target Sauce Demo login fields with current `getByLabel` strategy (observed 2026-08-16).
- Suspected findings:
  - Harness/browser-facade locator strategy may be misaligned with Sauce Demo placeholder inputs (inferred from fill timeouts vs. snapshot tree).
- Non-issues:
  - Redirect-to-login on protected routes appears intentional demo behavior, aligned with REQ-003 (observed only; not confirmed as requirement).
- Knowledge updates:
  - Sauce Demo is a client-side SPA: direct `.html` navigations return HTTP 404 then client router shows auth error on login view (observed).
  - Accepted usernames visible on login page include `standard_user`, `locked_out_user`, `problem_user`, `performance_glitch_user`, `error_user`, `visual_user` (observed; password hint redacted).
- Open questions:
  - Should `browser_fill_named` use placeholder locators when labels are absent, matching JRN-001 Playwright JSON?
  - What is the accessible name of the error-banner dismiss button?
  - Does empty Login submit show validation, or is POST policy blocking a real test gap?
- Follow-up:
  - Re-run authenticated exploration once fill/login interactions work through the facade.
  - Schedule negative-login charter for `locked_out_user` and invalid credentials.
  - Consider agentic-browser-testing smoke after happy path stabilizes.

## Findings summary

- Sessions: 1
- Bugs filed: 0 (tooling blockers recorded as RISK, not product defects)
- Questions: 3
- Risks noted: 3
- Evidence artifacts: 0 (session observations were recorded, but no sanitized evidence artifact was published)
