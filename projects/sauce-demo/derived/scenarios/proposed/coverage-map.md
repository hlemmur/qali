<!-- qali:generated owner=qali sha256=dee34350ad5930a26ad8f7fbd8866240f212777779a462b4206247b5db241eeb -->

# Coverage Map — Sauce Demo (Smoke)

> Qali-derived artifact. Maps requirements, journeys, and risks to test scenarios for the smoke slice.
> Project: `sauce-demo` · Feature: `smoke` · Generation request: `Ev0BQDM3SJBG`
> Produced: 2026-08-15 · Role: test-architect · Workflow: `design-coverage`

## Scope and authority

| Item                         | Value                                                | Status    | Source                         |
| ---------------------------- | ---------------------------------------------------- | --------- | ------------------------------ |
| Live target                  | `https://www.saucedemo.com`                          | confirmed | D-002                          |
| First live proof             | Login → inventory → cart on Chromium                 | confirmed | CTX-007, D-002                 |
| Credential handling          | Named fills; password from `qali-sauce-demo` secrets | confirmed | D-003, DATA-002                |
| Approved scenarios available | 0                                                    | observed  | harness inputs (none supplied) |
| Exploration report available | no                                                   | observed  | harness inputs (none supplied) |

Smoke scope is limited to the happy-path journeys **JRN-001** and **JRN-002**. **REQ-003** (invalid/locked accounts) is out of smoke scope and remains a documented gap.

## Requirements-to-test coverage matrix

| Scenario    | Requirement | Journey | Risk protected   | Test type                  | Priority | Status                      | Notes                                                                               |
| ----------- | ----------- | ------- | ---------------- | -------------------------- | -------- | --------------------------- | ----------------------------------------------------------------------------------- |
| SCN-SMK-001 | REQ-001     | JRN-001 | RSK-001, RSK-002 | E2E (Playwright, Chromium) | P0       | GAP — scenario not approved | Proposed from journey spec; asserts inventory visible after named login             |
| SCN-SMK-002 | REQ-002     | JRN-002 | RSK-001, RSK-003 | E2E (Playwright, Chromium) | P0       | GAP — scenario not approved | Depends on SCN-SMK-001; asserts selected product appears in cart                    |
| —           | REQ-003     | —       | RSK-001          | E2E (negative)             | P1       | GAP — deferred from smoke   | Invalid/locked accounts; defer until smoke happy path is approved and live-verified |

### Scenario detail (proposed — pending approval)

#### SCN-SMK-001: Sign in and view inventory

- **Requirement:** REQ-001 — A visitor can sign in with a named demo account and reach the product inventory.
- **Journey:** JRN-001
- **Preconditions:** Public origin reachable; `DATA-001` username and `DATA-002` password configured in `qali-sauce-demo`.
- **Behavior:** Open login page → fill named credentials → submit Login → inventory with at least one **Add to cart** control is visible.
- **Oracle:** Positive — first **Add to cart** button visible. Negative — login error or inventory not shown.
- **Automation notes:** Use web-first locators from JRN-001 Playwright block; never echo password in traces or reports.

#### SCN-SMK-002: Add a product to the cart

- **Requirement:** REQ-002 — An authenticated shopper can add a product to the cart from inventory.
- **Journey:** JRN-002
- **Preconditions:** SCN-SMK-001 succeeded (authenticated on inventory).
- **Behavior:** Add first available product to cart → open cart → selected product is listed.
- **Oracle:** Positive — cart lists the added product. Negative — cart empty or wrong item.
- **Automation notes:** Prefer deterministic product selection (first inventory item); shared public cart state (RSK-003) may require idempotent assertions.

## Risk alignment

| Risk ID | Priority   | Smoke relevance                                                 | Coverage action                                                                      |
| ------- | ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| RSK-001 | 9 (MEDIUM) | Public demo may change copy, inventory, or login without notice | SCN-SMK-001, SCN-SMK-002 use role/name oracles; avoid brittle CSS-only selectors     |
| RSK-002 | 8 (MEDIUM) | Named credentials could leak into Slack, traces, or git         | SCN-SMK-001 uses named fills per D-003; no credential values in artifacts            |
| RSK-003 | 8 (MEDIUM) | Shared public demo data is not isolated per run                 | SCN-SMK-002 documents shared-state risk; assertions tolerate standard demo inventory |

## Journey coverage

| Journey | Requirement | Scenario    | Covered                     |
| ------- | ----------- | ----------- | --------------------------- |
| JRN-001 | REQ-001     | SCN-SMK-001 | proposed — not yet approved |
| JRN-002 | REQ-002     | SCN-SMK-002 | proposed — not yet approved |

## Gap register

| ID      | Requirement / area | Gap type                       | Decision needed                  | Recommended action                                                   |
| ------- | ------------------ | ------------------------------ | -------------------------------- | -------------------------------------------------------------------- |
| GAP-001 | REQ-001            | No approved scenario           | Approve SCN-SMK-001 from JRN-001 | Human review → move to `approved` before executable automation       |
| GAP-002 | REQ-002            | No approved scenario           | Approve SCN-SMK-002 from JRN-002 | Human review after GAP-001                                           |
| GAP-003 | REQ-003            | Deferred from smoke            | Accept deferral for smoke slice  | Schedule negative-account scenarios after smoke live-verification    |
| GAP-004 | Exploration        | No exploration report ingested | Optional                         | Run exploration against live demo to confirm oracles before approval |

## Coverage summary

| Metric                                     | Count                                      |
| ------------------------------------------ | ------------------------------------------ |
| Requirements in smoke scope                | 2 (REQ-001, REQ-002)                       |
| Requirements mapped to a proposed scenario | 2                                          |
| Requirements with approved scenario        | 0                                          |
| Unexplained GAP rows                       | 0 (each GAP has deferral or approval note) |
| Journeys in smoke scope                    | 2                                          |
| P0 smoke scenarios proposed                | 2                                          |

## Entry and exit criteria (smoke slice)

**Entry**

- [ ] SCN-SMK-001 and SCN-SMK-002 approved in scenario registry
- [ ] `qali-sauce-demo` GitHub Environment secrets configured for `DATA-002`
- [ ] Public origin `https://www.saucedemo.com` reachable from CI

**Exit**

- [ ] REQ-001 and REQ-002 rows show **covered** (not GAP) in this matrix
- [ ] Chromium E2E run passes against live demo
- [ ] No credential material in traces, logs, or published artifacts

## Provenance

| Fact                                   | Status    | Source                              | Date       |
| -------------------------------------- | --------- | ----------------------------------- | ---------- |
| Smoke covers login → inventory → cart  | confirmed | CTX-007, D-002                      | 2026-08-13 |
| REQ-001/002/003 statements             | inferred  | requirements.md                     | 2026-08-13 |
| Journey steps and Playwright hints     | inferred  | journeys.md                         | 2026-08-13 |
| Risk scores                            | inferred  | risks.md                            | 2026-08-13 |
| Zero approved scenarios at design time | observed  | harness input set                   | 2026-08-15 |
| SCN-SMK-001/002 identifiers            | inferred  | smoke scope + journey decomposition | 2026-08-15 |
