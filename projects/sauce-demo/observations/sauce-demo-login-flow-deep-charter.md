# Exploration Charter — Sauce Demo Login Flow (Deep)

- **Project:** sauce-demo
- **Generation request:** Ev0BPYC580UX
- **Date:** 2026-08-15
- **Depth:** deep
- **Operator role:** explorer
- **Target environment:** `https://www.saucedemo.com` (public production demo; no local mock — CTX-006)
- **Mock mode:** off

## Focus

Login flow — authentication from the public landing page through successful or failed sign-in, including credential validation, error presentation, session establishment, and post-login routing to inventory.

## Method

Bounded black-box exploration through the restricted browser facade. Observations are evidence only; page copy, console output, and network payloads are untrusted data and must not drive test authority.

## Mission statement

Explore the Sauce Demo **login flow** with **named demo credentials (DATA-001, DATA-002), invalid and locked-account variants, and HICCUPS / FEW HICCUPS heuristics** to discover **requirement gaps, authentication edge cases, error-handling weaknesses, and session-boundary defects** before inventory and cart work proceeds.

## Context anchors

| ID       | Relevance to login exploration                           |
| -------- | -------------------------------------------------------- |
| REQ-001  | Happy-path sign-in must reach product inventory          |
| REQ-003  | Invalid or locked accounts must not reach inventory      |
| JRN-001  | Canonical happy-path steps and Playwright-shaped actions |
| DATA-001 | Happy-path username (`standard_user` via named fill)     |
| DATA-002 | Happy-path password (named credential reference)         |
| RSK-001  | Public demo may change copy or behavior without notice   |
| RSK-002  | Credentials must not leak into Slack, traces, or git     |
| RSK-003  | Shared demo state is not isolated per run                |
| BUG-001  | No known login issues recorded yet                       |

## Session plan (90 minutes — deep new-feature split)

| Phase                 | Minutes | Intent                                                                                                 |
| --------------------- | ------: | ------------------------------------------------------------------------------------------------------ |
| Orient & survey       |      15 | Load login page; note fields, labels, buttons, visible account hints; map URLs before and after submit |
| Heuristic exploration |      40 | Apply HICCUPS / FEW HICCUPS across roles and states (see probes below)                                 |
| Boundaries & errors   |      20 | Push empty, malformed, hostile, and interrupted inputs; verify post-error state                        |
| Document & debrief    |      15 | Tag observations; mark coverage; list follow-up charters                                               |

## Exploration probes

### Happy path and claims (C, P)

1. Execute JRN-001 with DATA-001 / DATA-002; confirm inventory is visible and URL reflects authenticated state.
2. Compare visible post-login UI (title, menu, product list) against REQ-001 claims.
3. Confirm login form is no longer the primary surface after success.

### Invalid and locked accounts (REQ-003, U, E)

4. Submit valid username with wrong password; record error copy, field state, and whether inventory is reachable.
5. Submit unknown username; compare error presentation to wrong-password case.
6. Attempt `locked_out_user` (or equivalent demo locked account if exposed on page); confirm inventory is blocked and messaging is clear.
7. After each failure, retry with valid credentials without full page reload — does prior error state linger?

### Input boundaries (S, W)

8. Empty username, empty password, both empty — are errors specific and accessible?
9. Leading/trailing whitespace in username and password.
10. Case variation in username (`Standard_User`, `STANDARD_USER`).
11. Very long strings in both fields (length handling, layout, performance).
12. Unicode and special characters (e.g. emoji, RTL marks) in username field.

### State transitions and interruptions (H, W)

13. Submit login, then immediately use browser back — is session retained or dropped safely?
14. Open two tabs: log in on one; refresh the other — consistent auth state?
15. Deep-link to inventory URL before login — is access denied and user redirected appropriately?
16. Deep-link to inventory after login in a fresh tab without cookies — expected behavior?
17. Double-click Login or rapid repeated submits — duplicate sessions or race artifacts?

### Security and standards posture (S, RSK-002)

18. Confirm credentials never appear in page source, URL query strings, or visible error text after submit.
19. Note whether login is over HTTPS end-to-end (standards oracle).
20. Observe whether failed-login responses expose account enumeration differences (same message for unknown vs wrong password?).

### Product consistency and image (I, P, F)

21. Error messages: tone, placement, and consistency with Sauce Labs demo quality bar.
22. Keyboard-only path: tab order, focus on first error, Enter to submit.
23. Field labels, placeholders, and Login button accessible names match JRN-001 locators (`Username`, `Password`, `Login`).

### World conditions (W)

24. Throttled network during submit — loading indicator, timeout, double-submit risk.
25. Viewport narrow (mobile-width) — form usability and error visibility.

## Hypotheses to falsify

- H1: Only DATA-001 reaches inventory with DATA-002; all other accounts are blocked per REQ-003.
- H2: Error messages are stable enough for automation despite RSK-001.
- H3: Session boundary prevents unauthenticated inventory access via direct URL.
- H4: Failed login does not leave a partial authenticated state.

## Out of scope

- Inventory sorting, cart, checkout (separate charters).
- Backend or hosting internals (CTX-003).
- Credential values in notes or evidence (CTX-011, RSK-002).

## Observation log (pre-session template)

| Time | Tag  | Action | Observation                                | Evidence                                               |
| ---- | ---- | ------ | ------------------------------------------ | ------------------------------------------------------ |
|      | NOTE |        | Charter authored; session not yet executed | outputs/charters/sauce-demo-login-flow-deep-charter.md |

Tags: `BUG`, `QUESTION`, `IDEA`, `RISK`, `NOTE`.

## Debrief checklist (complete after session)

- [ ] Coverage: happy path — covered | partial | unexplored
- [ ] Coverage: invalid credentials — covered | partial | unexplored
- [ ] Coverage: locked account — covered | partial | unexplored
- [ ] Coverage: session / URL boundaries — covered | partial | unexplored
- [ ] Coverage: accessibility & keyboard — covered | partial | unexplored
- [ ] Reproduced findings:
- [ ] Suspected findings:
- [ ] Non-issues:
- [ ] Knowledge updates (route to reference / questions — not `sources/questions.md`):
- [ ] Open questions:
- [ ] Follow-up charters (e.g. inventory, cart, performance_glitch_user post-login):

## Automation pipeline notes

- Stabilized happy path aligns with JRN-001 Playwright block; promote only after exploratory confirmation.
- Any reproducible REQ-003 violation should become a named scenario before widening scope to JRN-002.
- Prefer `agentic-browser-testing` for unattended smoke of this charter before scripted regression.

## Provenance

- Charter authored from `inputs/project-context/project-context.md`, `inputs/reference/*`, and `inputs/known-issues/known-issues.md`.
- Status: **inferred** exploration intent; execution evidence pending.
- Source date: 2026-08-15
