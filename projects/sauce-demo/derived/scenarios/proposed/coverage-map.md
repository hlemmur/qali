<!-- qali:generated owner=qali sha256=9ad86ea78ab182a50f6704092b0673399f1994b6f09d11c8bc8db555c3de1bb5 -->

# Coverage Map — Sauce Demo

> Qali-derived artifact. Maps requirements, journeys, and risks to test scenarios.
> Generated: 2026-08-15 | Project: sauce-demo | Workflow: design-coverage | Generation request: Ev0BQDNFRY5U

## Scope

| Dimension             | Value                                | Source                                   |
| --------------------- | ------------------------------------ | ---------------------------------------- |
| Target origin         | `https://www.saucedemo.com`          | CTX-002, D-002                           |
| First live proof      | Login → inventory → cart on Chromium | CTX-007                                  |
| In-scope requirements | REQ-001, REQ-002, REQ-003            | requirements.md                          |
| In-scope journeys     | JRN-001, JRN-002                     | journeys.md                              |
| Approved scenarios    | 0                                    | approved/ (empty)                        |
| Proposed scenarios    | 0                                    | proposed/ (empty)                        |
| Exploration report    | Not available                        | exploration.md / exploration.json absent |

## Requirements-to-Scenario Coverage

| Scenario | Requirement | Journey | Risk             | Status   | Priority | Test type | Notes                                                                                                            |
| -------- | ----------- | ------- | ---------------- | -------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| SCN-001  | REQ-001     | JRN-001 | RSK-001, RSK-002 | proposed | P0       | E2E       | Happy-path login with named credentials (`DATA-001`, `DATA-002`); assert inventory visible (Add to cart button). |
| SCN-002  | REQ-002     | JRN-002 | RSK-001, RSK-003 | proposed | P0       | E2E       | Depends on SCN-001; add first inventory item; open cart; assert product listed.                                  |
| SCN-003  | REQ-003     | —       | RSK-001          | GAP      | P1       | E2E       | Negative login: invalid or locked account must not reach inventory. No journey or approved scenario yet.         |

**Coverage summary:** 2 of 3 requirements have proposed scenarios; 1 GAP (REQ-003).

## Journey Coverage

| Journey | Scenario | Covered steps                                                    | Status   |
| ------- | -------- | ---------------------------------------------------------------- | -------- |
| JRN-001 | SCN-001  | Open login → fill username/password → submit → inventory visible | proposed |
| JRN-002 | SCN-002  | Add product → open cart → product in cart                        | proposed |

JRN-002 precondition (JRN-001 succeeded) chains SCN-002 after SCN-001 in execution order.

## Risk Alignment

| Risk ID | Priority | Zone | Scenarios exercising mitigation | Gap                                                                                                                                     |
| ------- | -------- | ---- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| RSK-001 | 9        | HIGH | SCN-001, SCN-002                | Use web-first Playwright locators (role, placeholder); avoid copy-specific assertions where possible.                                   |
| RSK-002 | 8        | HIGH | SCN-001                         | Named fills from secrets only; never echo password in traces, logs, or artifacts.                                                       |
| RSK-003 | 8        | HIGH | SCN-002                         | Shared public cart state — use deterministic product selection; accept possible cross-run interference or document as known limitation. |

## Scenario Definitions (Proposed)

### SCN-001: Sign in and view inventory

- **Status:** proposed
- **Source:** JRN-001, REQ-001
- **Links:** REQ-001, JRN-001, RSK-001, RSK-002, DATA-001, DATA-002
- **Preconditions:** Public origin reachable; `qali-sauce-demo` credentials configured
- **Behavior:** Given login page → When named credentials submitted → Then inventory with Add to cart control is visible
- **Automation:** Playwright per JRN-001 `qali-playwright` block

### SCN-002: Add a product to the cart

- **Status:** proposed
- **Source:** JRN-002, REQ-002
- **Links:** REQ-002, JRN-002, RSK-001, RSK-003
- **Preconditions:** SCN-001 passed (authenticated on inventory)
- **Behavior:** Given inventory → When user adds a product and opens cart → Then selected product appears in cart
- **Automation:** Extend JRN-001 flow with add-to-cart and cart navigation

### SCN-003: Reject invalid or locked login (GAP)

- **Status:** GAP
- **Source:** REQ-003
- **Links:** REQ-003, RSK-001
- **Behavior:** Given login page → When invalid or locked credentials submitted → Then inventory is not reachable; error feedback shown
- **Blocker:** No journey, test data IDs, or exploration evidence for locked/invalid accounts. Requires recorded decision on account matrix before scenario approval.

## Prioritization (Risk × Effort)

| Scenario | Risk zone               | Effort (E2E) | Action                                                   |
| -------- | ----------------------- | ------------ | -------------------------------------------------------- |
| SCN-001  | HIGH (RSK-001, RSK-002) | ~2–3 hr      | DO FIRST — satisfies CTX-007 entry criterion             |
| SCN-002  | HIGH (RSK-003)          | ~1–2 hr      | DO FIRST — completes CTX-007 smoke path                  |
| SCN-003  | MEDIUM                  | ~2 hr        | DO SECOND — closes REQ-003 GAP after test-data authority |

## Open Items

| ID        | Question                                                                                                                 | Blocks                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Q-COV-001 | Which locked/invalid accounts and expected error messages define REQ-003?                                                | SCN-003 approval              |
| Q-COV-002 | Exploration report absent — any observed behaviors beyond JRN-001/002 to map?                                            | Additional scenario proposals |
| Q-COV-003 | Untrusted generation intent referenced feature `discoveries`; no REQ/journey/risk linkage in governed sources. In scope? | Scope confirmation            |

## Entry / Exit Criteria (for downstream execution)

**Entry:** SCN-001 and SCN-002 approved; credentials in `qali-sauce-demo`; Chromium runner available.

**Exit:** REQ-001 and REQ-002 covered by passing E2E; REQ-003 either covered by SCN-003 or GAP accepted with recorded decision; zero unexplained GAP rows without accept/defer note.
