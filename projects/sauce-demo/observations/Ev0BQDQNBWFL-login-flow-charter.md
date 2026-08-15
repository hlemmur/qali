# Exploration Charter — Login Flow (Deep)

- **Project:** sauce-demo
- **Generation request:** Ev0BQDQNBWFL
- **Date:** 2026-08-15
- **Operator:** Explorer (charter step)
- **Depth:** deep
- **Target environment:** `https://www.saucedemo.com` (public production demo; no mock — CTX-006)

## Required fields

| Field      | Value                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- |
| **Focus**  | Login flow — username/password form, authentication outcomes, and post-login routing to inventory |
| **Method** | Bounded black-box exploration through the restricted browser facade                               |

## Charter

Explore the Sauce Demo **login flow** with **named happy-path credentials (DATA-001 / DATA-002), publicly documented demo account variants, invalid and boundary input, and state-transition interruptions** to discover **requirement gaps, authentication edge cases, error-handling weaknesses, and UX inconsistencies** before and after reaching inventory.

## Context and authority links

| Artifact     | IDs                       | Relevance                                                         |
| ------------ | ------------------------- | ----------------------------------------------------------------- |
| Requirements | REQ-001, REQ-003          | Happy-path sign-in; blocked access for invalid or locked accounts |
| Journey      | JRN-001                   | Baseline sign-in → inventory path                                 |
| Test data    | DATA-001, DATA-002        | Confirmed happy-path username and password references             |
| Risks        | RSK-001, RSK-002, RSK-003 | Demo drift; credential leakage; shared public state               |
| Known issues | BUG-001                   | No confirmed defects recorded — treat as greenfield for login     |

## Session plan (deep dive)

Deep depth is split across **two time-boxed sessions** (60–90 minutes each) to preserve attention and allow debrief between passes.

### Session A — Roles, outcomes, and claims (≈75 min)

| Phase            | Minutes | Activity                                                                                                               |
| ---------------- | ------: | ---------------------------------------------------------------------------------------------------------------------- |
| Orient           |      15 | Open login page; record visible copy, field labels, demo-account hints, and baseline layout (HICCUPS: Image, Claims)   |
| Happy path       |      15 | Execute JRN-001 with DATA-001 / DATA-002; confirm inventory and session persistence                                    |
| Account variants |      25 | Exercise publicly listed demo accounts (e.g. locked, problem, performance, error, visual) against REQ-003 expectations |
| Error surface    |      15 | Empty fields, wrong password, unknown username, swapped fields, case sensitivity                                       |
| Document         |       5 | Tag observations; note credential handling (no echo in notes — RSK-002)                                                |

### Session B — Boundaries, state, and world conditions (≈75 min)

| Phase                | Minutes | Activity                                                                                                 |
| -------------------- | ------: | -------------------------------------------------------------------------------------------------------- |
| Review               |      10 | Read Session A log; pick highest-risk open questions                                                     |
| Boundary probes      |      20 | Long strings, Unicode, leading/trailing whitespace, special characters in username/password              |
| State transitions    |      20 | Back button after login, refresh on login page, duplicate tabs, submit twice, navigate away mid-fill     |
| World / FEW HICCUPS  |      15 | Throttled network (if facade supports), viewport resize, keyboard-only navigation, focus order           |
| Security & standards |       5 | Password field masking, autocomplete attributes, error message consistency (HICCUPS: Standards, Product) |
| Document             |       5 | Debrief both sessions; mark coverage                                                                     |

## Heuristic lenses

Apply **HICCUPS** and **FEW HICCUPS** throughout; prioritize oracles marked **bold** for login.

| Oracle                | Login-specific probes                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| **Claims**            | Does behavior match on-page demo-account descriptions and REQ-001 / REQ-003?           |
| **User expectations** | Are error messages actionable? Is locked-out state clearly distinct from bad password? |
| **Product**           | Do login errors match tone/style used elsewhere on the demo site?                      |
| **Comparable**        | How do common auth patterns (generic error, rate limiting, lockout messaging) compare? |
| Familiarity           | Can a first-time visitor identify required fields without reading docs?                |
| Explainability        | Can each outcome (inventory, error, lockout) be explained in one sentence?             |
| World                 | Does login remain usable on narrow viewports and with keyboard-only input?             |

## Test-idea bank (login-focused)

### Boundary

- Empty username, empty password, both empty
- Username only / password only
- Maximum-length and over-length strings in both fields
- Unicode, emoji, and RTL characters in username
- Leading/trailing spaces; copy-paste with trailing newline
- Case variants of `standard_user` and password

### State transition

- Submit login, then browser Back — expected session behavior?
- Refresh while on login form with partially filled fields
- Open second tab; log in on one; state on the other
- Double-click Login or rapid resubmit
- Login success then direct navigation to `/` without logout

### Error handling

- `locked_out_user` (or equivalent public demo account) — must not reach inventory (REQ-003)
- `problem_user` — document any intermittent or data-dependent behavior
- `performance_glitch_user` — note latency tolerance and loading indicators
- `error_user` — capture error presentation without treating transient demo noise as product truth
- Invalid credential pairs — single generic vs specific messages

### “What if”

- Autofill / password manager injection
- Disable JavaScript (if facade allows) — graceful degradation?
- Deep-link to inventory URL while logged out — redirect behavior?

## Coverage map

| Area                                | Session | Expected depth                    |
| ----------------------------------- | ------- | --------------------------------- |
| Happy-path login (JRN-001)          | A       | covered                           |
| Invalid / locked accounts (REQ-003) | A       | covered                           |
| Field validation and error copy     | A       | covered                           |
| Input boundaries                    | B       | covered                           |
| Navigation and session state        | B       | covered                           |
| Accessibility and keyboard path     | B       | partial (flag gaps for follow-up) |
| Network degradation                 | B       | partial (environment-dependent)   |

## Assumptions

- Public demo account names and behaviors match the hints displayed on the login page at session time (RSK-001).
- Named credentials for DATA-002 resolve correctly in the `qali-sauce-demo` environment and are never logged (RSK-002).
- Exploration observations describe **observed** behavior; promotion to **confirmed** requirements requires authority.

## Open questions (for exploration log)

| ID    | Question                                                                                            | Tag      |
| ----- | --------------------------------------------------------------------------------------------------- | -------- |
| Q-001 | Does the application show the same error for unknown user vs wrong password?                        | QUESTION |
| Q-002 | After successful login, is inventory URL bookmarkable and does refresh preserve session?            | QUESTION |
| Q-003 | Are demo-account restrictions (locked, problem, etc.) documented consistently with actual behavior? | QUESTION |
| Q-004 | Is there any client-side validation before submit, or only server-side responses?                   | QUESTION |
| Q-005 | Does logout exist on inventory, and does it return a clean unauthenticated login state?             | QUESTION |

## Follow-up charters

- **Inventory and cart smoke** — after login stabilizes, charter JRN-002 for add-to-cart (CTX-007 scope).
- **Checkout regression** — deferred until login and cart charters are debriefed.
- **Agentic smoke** — hand stabilized JRN-001 to `agentic-browser-testing` before Playwright promotion.

## Session log scaffold

Use `templates/session-log.md` when executing. Pre-fill:

```
Charter: Explore the Sauce Demo login flow with named happy-path credentials (DATA-001 / DATA-002), publicly documented demo account variants, invalid and boundary input, and state-transition interruptions to discover requirement gaps, authentication edge cases, error-handling weaknesses, and UX inconsistencies before and after reaching inventory.
Account / role: DATA-001 (primary); public demo variants as listed on login page
Mock mode: off
```

## Debrief checklist (post-execution)

- [ ] Charter sentence present and specific
- [ ] Observations time-stamped with BUG / QUESTION / IDEA / RISK / NOTE tags
- [ ] REQ-001 and REQ-003 each marked covered, partial, or unexplored
- [ ] RSK-002: no credentials in logs, screenshots, or Slack
- [ ] Reproducible bugs linked to charter and steps
- [ ] Follow-up session scheduled or explicitly deferred
