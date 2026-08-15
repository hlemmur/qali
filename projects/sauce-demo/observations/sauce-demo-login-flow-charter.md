# Exploration Charter — Sauce Demo Login Flow (Deep)

- **Project:** sauce-demo
- **Generation request:** Ev0BPYCU3C4X
- **Date:** 2026-08-15
- **Depth:** deep
- **Target / environment:** `https://www.saucedemo.com` (public demo; mock mode off)

## Required fields

| Field      | Value                                                               |
| ---------- | ------------------------------------------------------------------- |
| **Focus**  | login flow                                                          |
| **Method** | bounded black-box exploration through the restricted browser facade |

## Charter

> Explore the Sauce Demo login flow with named demo accounts, invalid and locked credentials, and boundary input conditions to discover requirement gaps, error-handling weaknesses, security signals, and UX inconsistencies before inventory is reached.

## Context

Sauce Demo is a public sample storefront (CTX-001, CTX-002). First live proof targets login → inventory → cart on Chromium (CTX-007). No local mock exists; exploration hits production demo only (CTX-006). Named credentials come from GitHub Environment secrets and must never be committed or echoed (CTX-011, RSK-002).

Known issues register is empty (BUG-001). Requirements REQ-001 (happy-path sign-in) and REQ-003 (invalid/locked rejection) are inferred and need live confirmation.

## Linked artifacts

| Type         | IDs                                                   |
| ------------ | ----------------------------------------------------- |
| Requirements | REQ-001, REQ-003                                      |
| Journeys     | JRN-001                                               |
| Risks        | RSK-001, RSK-002, RSK-003                             |
| Test data    | DATA-001 (`standard_user`), DATA-002 (named password) |

## Resources

### Demo accounts to exercise

| Username                   | Purpose                                |
| -------------------------- | -------------------------------------- |
| `standard_user` (DATA-001) | Happy path — reach inventory (JRN-001) |
| `locked_out_user`          | Locked account rejection (REQ-003)     |
| `problem_user`             | Post-login defect surfacing            |
| `performance_glitch_user`  | Latency and loading behavior           |
| `error_user`               | Server-side error after login          |
| `visual_user`              | Layout and visual consistency          |

Password for all accounts: named credential DATA-002 via `QALI_TEST_CREDENTIALS_JSON`.

## Information goals

1. Confirm REQ-001 — named account reaches inventory after login.
2. Confirm REQ-003 — invalid, empty, and locked accounts do not reach inventory.
3. Characterize error messages, timing, and recovery for each failure mode.
4. Probe state transitions: refresh, back button, duplicate tabs, double submit.
5. Watch for credential/session leakage (RSK-002).
6. Detect public-demo drift in copy or flow (RSK-001).
7. Apply HICCUPS / FEW HICCUPS for UX, accessibility, and consistency.

## Hypotheses

- Locked and invalid accounts show distinct, actionable errors without stack traces.
- Empty or whitespace-only credentials are rejected at login.
- Double-clicking Login does not create inconsistent session state.
- Browser back from inventory requires re-authentication.
- Long or special-character inputs do not bypass validation.
- `performance_glitch_user` reveals whether loading indicators handle delay gracefully.

## Heuristic attack areas

### Boundary

- Empty username/password; whitespace-only fields
- Correct username + wrong password (and reverse)
- Max-length and Unicode strings; case sensitivity

### State transition

- Submit → refresh; submit → back
- Two tabs: authenticate in one, observe the other
- Direct `/inventory.html` while logged out

### Error handling

- `locked_out_user` message and retry
- `error_user` post-login failure
- Missing or malformed form fields

### What if

- Pasted credentials with leading/trailing spaces
- Autofill / password-manager behavior
- Keyboard-only navigation and screen-reader labels
- Mobile viewport on login form

## Session plan (90 minutes)

| Phase                       | Minutes | Activities                                              |
| --------------------------- | ------- | ------------------------------------------------------- |
| Orient and survey           | 15      | Load login page; baseline copy, fields, console/network |
| Happy path + account matrix | 25      | JRN-001; all demo accounts; tag outcomes                |
| Boundaries + hostile inputs | 20      | Invalid combos; empty fields; special characters        |
| State transitions           | 15      | Refresh, back, duplicate tab, double submit, direct URL |
| Wrap-up                     | 15      | Tag observations; mark coverage; list follow-ups        |

## Coverage targets

| Area                         | Link    | Priority |
| ---------------------------- | ------- | -------- |
| Happy-path login → inventory | REQ-001 | must     |
| Locked/invalid rejection     | REQ-003 | must     |
| Input boundaries             | REQ-003 | should   |
| State/session behavior       | —       | should   |
| UX and error presentation    | —       | should   |
| Credential leakage signals   | RSK-002 | must     |

## Open questions (for exploration log)

| ID          | Question                                                                   |
| ----------- | -------------------------------------------------------------------------- |
| Q-LOGIN-001 | Does `locked_out_user` show a stable user-facing message on every attempt? |
| Q-LOGIN-002 | Are usernames case-sensitive for all demo accounts?                        |
| Q-LOGIN-003 | Does direct `/inventory.html` without session redirect to login?           |
| Q-LOGIN-004 | Is the named password exposed in UI, URL, or console (RSK-002)?            |
| Q-LOGIN-005 | Has login page copy changed since sources were last checked (RSK-001)?     |

## Follow-up

- Stabilized happy path → `agentic-browser-testing` smoke, then Playwright regression.
- Next charters: inventory/cart (CTX-007), checkout after login changes.

## Session log

Use `templates/session-log.md`. Tag observations: `BUG`, `QUESTION`, `IDEA`, `RISK`, `NOTE`. Record open questions in the exploration log, not reviewer-owned `sources/questions.md`.
