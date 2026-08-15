<!-- qali:generated owner=qali sha256=a770717fb3bc97ba554fc2220f38d8537c583122b6d4337d94a755d801d63a28 -->

# Coverage Map — Sauce Demo (Smoke)

> Qali-derived artifact. Maps requirements and risks to planned smoke scenarios.
> Regenerate via `design-coverage`; do not hand-edit.

## Metadata

| Field              | Value                                        |
| ------------------ | -------------------------------------------- |
| Project            | sauce-demo                                   |
| Feature slice      | smoke                                        |
| Generation request | Ev0BR9U3GY3S                                 |
| Workflow step      | design-coverage                              |
| Profile            | coverage-design                              |
| Authored           | 2026-08-15                                   |
| Target origin      | `https://www.saucedemo.com` (D-002, CTX-002) |
| Exploration report | not present in harness inputs                |
| Approved scenarios | none in harness inputs                       |
| Proposed scenarios | none in harness inputs                       |

## Scope

First live proof per CTX-007: login → inventory → cart on Chromium against the public demo origin. Smoke depth only; checkout and multi-browser expansion are out of scope for this slice.

### In scope

- Happy-path authentication with named demo credentials (DATA-001, DATA-002, D-003)
- Inventory visibility after login (REQ-001, JRN-001)
- Add one product to cart and verify cart contents (REQ-002, JRN-002)
- Material negative path: invalid credentials do not reach inventory (REQ-003)

### Out of scope (defer)

- Full checkout and payment flows
- Cross-browser matrix beyond Chromium smoke
- Cart isolation or reset guarantees on shared public demo data (RSK-003 accepted at smoke tier)
- Locked-account matrix beyond one invalid-login oracle (see GAP-001)

## Requirements-to-Scenario Matrix

| Scenario | Requirement | Journey | Risk             | Priority | Test type      | Status   | Oracle summary                                                             |
| -------- | ----------- | ------- | ---------------- | -------- | -------------- | -------- | -------------------------------------------------------------------------- |
| SMK-001  | REQ-001     | JRN-001 | RSK-001, RSK-002 | P0       | E2E Playwright | proposed | After named login, inventory shows at least one **Add to cart** control    |
| SMK-002  | REQ-002     | JRN-002 | RSK-001, RSK-003 | P0       | E2E Playwright | proposed | After add-to-cart and open cart, selected product appears in cart list     |
| SMK-003  | REQ-003     | —       | RSK-001          | P1       | E2E Playwright | proposed | Invalid username/password keeps user off inventory; error feedback visible |

### Requirement coverage summary

| Requirement | Statement (abbrev.)             | Scenario coverage | Coverage status                                    |
| ----------- | ------------------------------- | ----------------- | -------------------------------------------------- |
| REQ-001     | Sign in and reach inventory     | SMK-001           | mapped                                             |
| REQ-002     | Add product to cart             | SMK-002           | mapped                                             |
| REQ-003     | Invalid/locked accounts blocked | SMK-003           | mapped (locked-account variant deferred — GAP-001) |

## Journey alignment

| Journey | Goal                       | Scenarios exercising path | Notes                                                                    |
| ------- | -------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| JRN-001 | Sign in and view inventory | SMK-001                   | Preconditions: public origin reachable; credentials in `qali-sauce-demo` |
| JRN-002 | Add product to cart        | SMK-002                   | Preconditions: SMK-001 or equivalent login setup                         |

## Risk-to-Scenario alignment

| Risk    | Priority | Scenarios mitigating      | Mitigation depth (smoke)                                                       | Residual                                                                |
| ------- | -------- | ------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| RSK-001 | 9        | SMK-001, SMK-002, SMK-003 | Happy path + one negative asserts stable oracles (visible controls, cart item) | Copy/layout drift may still break locators; no visual baseline in smoke |
| RSK-002 | 8        | SMK-001                   | Named fills only; password never echoed in artifacts                           | Credential leak into traces/Slack not asserted in smoke                 |
| RSK-003 | 8        | SMK-002                   | Single add-to-cart observation only                                            | Shared demo cart state not reset or isolated per run                    |

## Gap register

| Gap ID  | Requirement / risk | Description                                                                                                       | Decision                                                                                          |
| ------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GAP-001 | REQ-003            | Locked-account (`locked_out_user`) path not in test-data pack; only invalid-credentials oracle planned in SMK-003 | defer — accept smoke covers rejection oracle; add locked-user scenario when DATA-003 is confirmed |
| GAP-002 | RSK-002            | No automated check that traces/reports omit password material                                                     | defer — process/control risk; not smoke-oracle scope                                              |
| GAP-003 | RSK-003            | No cart reset or isolated session strategy on public demo                                                         | accept risk at smoke tier per CTX-006                                                             |

## Smoke execution order

1. SMK-001 — establishes authenticated inventory session
2. SMK-002 — extends session through cart verification
3. SMK-003 — independent unauthenticated negative (may run in parallel after credential fixtures exist)

## Entry and exit criteria (smoke slice)

### Entry

- D-002 live target confirmed
- Named credentials available in GitHub Environment `qali-sauce-demo` (D-003)
- Playwright Chromium runner configured (CTX-004)

### Exit

- All P0 rows (SMK-001, SMK-002) mapped with proposed scenarios ready for approval
- REQ-001 and REQ-002 have no unexplained GAP rows
- GAP-001, GAP-002, GAP-003 documented with accept/defer notes

## Provenance

| Fact ID                   | Used for                                         |
| ------------------------- | ------------------------------------------------ |
| CTX-002, CTX-006, CTX-007 | scope and environment                            |
| D-002, D-003              | authority for target URL and credential handling |
| DATA-001, DATA-002        | SMK-001 happy-path data                          |
| REQ-001–REQ-003           | requirement columns                              |
| JRN-001, JRN-002          | journey linkage                                  |
| RSK-001–RSK-003           | risk alignment                                   |
