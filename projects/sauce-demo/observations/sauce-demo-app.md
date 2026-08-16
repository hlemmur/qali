# Exploration Charter — Sauce Demo App

- **Project:** sauce-demo
- **Feature:** app (core shopper experience)
- **Date:** 2026-08-16
- **Operator:** Explorer (Qali harness)
- **Environment:** `https://www.saucedemo.com` (public production demo; no local mock)
- **Account / role:** `standard_user` (DATA-001) with named credential fill (DATA-002)
- **Mock mode:** off

## Charter

Explore the Sauce Demo login, inventory, and cart flows with the `standard_user` account, invalid/locked account variants, and HICCUPS heuristics to discover requirement gaps, authentication edge cases, and cart-state inconsistencies before first live Playwright proof.

## Required Fields

| Field      | Value                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| **Focus**  | Login form → product inventory → add-to-cart → cart badge and cart page (REQ-001, REQ-002, REQ-003; JRN-001, JRN-002) |
| **Method** | Bounded black-box exploration through the restricted browser facade against the public origin only                    |

## Context

- **Quality goal (CTX-007):** First live proof is login → inventory → cart on Chromium.
- **Known issues:** None recorded (BUG-001).
- **Session type:** New-feature discovery — learn the demo storefront, validate inferred requirements, and surface gaps for scenario approval.

## Hypotheses and Suspicions

1. Invalid or locked accounts may show inconsistent error copy or partially reach inventory (REQ-003).
2. Shared public demo state (RSK-003) may leave stale cart badges or items from prior visitors.
3. The public demo can change copy, inventory, or login behavior without notice (RSK-001), breaking selectors or assertions.
4. Cart badge count may desync when adding multiple items or navigating back to inventory.

## Risks to Watch

| ID      | Risk                        | Exploration angle                                                        |
| ------- | --------------------------- | ------------------------------------------------------------------------ |
| RSK-001 | Demo changes without notice | Capture visible labels, button text, and inventory structure as evidence |
| RSK-002 | Credential leakage          | Never echo passwords; note only whether named fills succeed              |
| RSK-003 | Shared public data          | Observe cart state on fresh session vs. after add-to-cart                |

## Time Box (75 minutes)

| Phase          | Duration | Activity                                                                                 |
| -------------- | -------- | ---------------------------------------------------------------------------------------- |
| Orient         | 15 min   | Load login page; survey layout, fields, and visible copy; confirm origin reachability    |
| Core flow      | 25 min   | Execute JRN-001 and JRN-002 with `standard_user`; note inventory and cart behavior       |
| Negative paths | 15 min   | Try invalid username/password and locked-user patterns per REQ-003                       |
| Heuristics     | 15 min   | Apply HICCUPS lenses (Claims, User expectations, Product consistency) on errors and cart |
| Wrap-up        | 5 min    | Tag observations; list open questions and follow-up charters                             |

## Heuristic Lenses (HICCUPS)

- **Claims:** Does login success match the stated demo credential behavior on saucedemo.com?
- **User expectations:** Are error messages clear when login fails? Is the cart badge intuitive?
- **Product:** Do inventory and cart pages share consistent styling, navigation, and terminology?
- **Comparable:** How does add-to-cart feedback compare to typical e-commerce patterns (badge update, button state)?

## Test Ideas (not yet scripted)

1. Login with empty username and/or password — expect blocking error, no inventory.
2. Login with `locked_out_user` (if available on demo) — expect rejection per REQ-003.
3. Add one product, verify cart badge shows `1`, open cart, confirm product name matches selection.
4. Add a second distinct product — verify badge increments and both items appear in cart.
5. Use browser back from cart to inventory — check whether badge and button states remain consistent.
6. Fresh session (new browser context) — confirm cart starts empty despite shared demo backend (RSK-003).

## Requirement and Journey Links

| Artifact     | IDs                       |
| ------------ | ------------------------- |
| Requirements | REQ-001, REQ-002, REQ-003 |
| Journeys     | JRN-001, JRN-002          |
| Test data    | DATA-001, DATA-002        |
| Risks        | RSK-001, RSK-002, RSK-003 |

## Observations

> Append during session execution. Tags: `BUG`, `QUESTION`, `IDEA`, `RISK`, `NOTE`.

| Time | Tag  | Action           | Observation                                                                                          | Evidence                           |
| ---- | ---- | ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| —    | NOTE | Charter authored | Charter prepared from project context, reference, and known-issues inputs; session not yet executed. | outputs/charters/sauce-demo-app.md |

## Open Questions

| ID    | Question                                                                                                       | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------- |
| Q-001 | Which invalid and locked demo accounts are officially supported on saucedemo.com for REQ-003 negative testing? | unknown |
| Q-002 | Does the shared public cart persist per session cookie or globally across visitors (RSK-003)?                  | unknown |
| Q-003 | Is checkout in scope for a follow-up charter after login → inventory → cart stabilizes?                        | unknown |

## Follow-Up Charters (deferred)

1. **Checkout flow** — Explore checkout steps after cart stabilization to discover form-validation and order-summary gaps.
2. **Menu and session exit** — Explore hamburger menu, logout, and session persistence to discover state-leak regressions.
3. **Sort and filter** — Explore inventory sort controls to discover ordering inconsistencies.

## Debrief (pre-session)

- **Coverage:** unexplored (charter only; execution pending)
- **Reproduced findings:** none
- **Suspected findings:** none
- **Non-issues:** none
- **Knowledge updates:** none
- **Follow-up:** Execute this charter via browser facade; promote stabilized happy path to agentic-browser-testing then Playwright per exploration-to-automation pipeline.
