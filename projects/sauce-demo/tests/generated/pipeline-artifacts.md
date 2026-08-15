# Generation Pipeline — Sauce Demo Smoke Suite

> Generation request: Ev0BQDNFRY5U | Feature intent: discoveries | Scope: SCN-001, SCN-002 from coverage-map.md

## Step 1 — Requirements Extract

| ID       | Entity / rule                                | Source                            |
| -------- | -------------------------------------------- | --------------------------------- |
| REQ-001  | Named demo account reaches product inventory | requirements.md                   |
| REQ-002  | Authenticated shopper adds product to cart   | requirements.md                   |
| REQ-003  | Invalid/locked accounts blocked              | requirements.md (GAP — not coded) |
| DATA-001 | Username `standard_user` via env             | test-data.md                      |
| DATA-002 | Password via named credential env            | test-data.md                      |

## Step 2 — Risks & Invariants

| Risk                     | Mitigation in suite                                           |
| ------------------------ | ------------------------------------------------------------- |
| RSK-001 UI drift         | Role/placeholder locators for login; first Add to cart button |
| RSK-002 Credential leak  | Password only from `QALI_TEST_CREDENTIALS_JSON`; never logged |
| RSK-003 Shared demo cart | Deterministic first product; documented limitation            |

**Invariant:** Authenticated inventory shows at least one Add to cart control.

## Step 3 — Coverage Matrix

| Requirement | Scenario | Category | Priority | Oracle                                |
| ----------- | -------- | -------- | -------- | ------------------------------------- |
| REQ-001     | SCN-001  | Happy    | P0       | Add to cart visible; login form gone  |
| REQ-002     | SCN-002  | Happy    | P0       | Selected product link visible in cart |
| REQ-003     | SCN-003  | Negative | P1       | DEFER — no approved test data         |

## Step 4 — Scenarios

See `inputs/scenarios/coverage-map.md` SCN-001 and SCN-002 definitions.

## Step 5 — Oracles

### SCN-001

- **Positive:** `getByRole('button', { name: 'Add to cart' }).first()` visible
- **Negative:** Login button not visible after submit
- **Side effect:** none asserted (public demo)

### SCN-002

- **Positive:** Product name captured before add appears as cart link
- **Negative:** none beyond cart visibility
- **Side effect:** cart badge may change (not asserted — RSK-003)

## Step 7 — Review Notes

| Test                              | Decision | Notes                                    |
| --------------------------------- | -------- | ---------------------------------------- |
| scn-001-sign-in-inventory.spec.ts | KEEP     | Traces to REQ-001 / SCN-001 / JRN-001    |
| scn-002-add-to-cart.spec.ts       | KEEP     | Traces to REQ-002 / SCN-002 / JRN-002    |
| SCN-003 (REQ-003 negative login)  | DEFER    | Blocked on Q-COV-001 test-data authority |

**Scope note:** Untrusted feature `discoveries` has no governed REQ linkage (Q-COV-003). Tests generated from design-coverage proposed scenarios only.

**Human review:** pending — required before merge per pipeline policy.
