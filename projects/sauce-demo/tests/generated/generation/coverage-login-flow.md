# Login flow — generation intermediates

Generation request: Ev0BQA8XPP45 | Project: sauce-demo | Depth: deep

## Step 1 — Requirements extracted

| ID       | Statement                                                   | Status    |
| -------- | ----------------------------------------------------------- | --------- |
| REQ-001  | Named demo account can sign in and reach inventory          | inferred  |
| REQ-003  | Invalid or locked accounts do not reach inventory           | inferred  |
| DATA-001 | Happy-path username `standard_user` via QALI_TEST_DATA_JSON | confirmed |
| DATA-002 | Password via QALI_TEST_CREDENTIALS_JSON                     | confirmed |

## Step 2 — Risks and invariants

| Risk/Invariant | Notes                                                                |
| -------------- | -------------------------------------------------------------------- |
| RSK-002        | Password never committed; tests read QALI_TEST_CREDENTIALS_JSON only |
| INV-LOGIN-01   | Failed auth never navigates to inventory.html                        |
| INV-LOGIN-02   | Error banner visible on rejected login                               |

## Step 3 — Coverage matrix

| Requirement | Scenario      | Category | Priority | Oracle                                     |
| ----------- | ------------- | -------- | -------- | ------------------------------------------ |
| REQ-001     | SCN-LOGIN-001 | Happy    | P0       | URL inventory, Products title, Add to cart |
| REQ-001     | SCN-LOGIN-002 | Happy    | P1       | Form controls visible                      |
| REQ-001     | SCN-LOGIN-009 | Happy    | P2       | Alternate valid user reaches inventory     |
| REQ-003     | SCN-LOGIN-003 | Negative | P0       | locked_out error, no inventory URL         |
| REQ-003     | SCN-LOGIN-004 | Negative | P0       | mismatch error, no inventory URL           |
| REQ-003     | SCN-LOGIN-005 | Negative | P1       | unknown user error                         |
| REQ-003     | SCN-LOGIN-006 | Negative | P1       | username required                          |
| REQ-003     | SCN-LOGIN-007 | Negative | P1       | password required                          |
| REQ-003     | SCN-LOGIN-008 | Negative | P2       | both empty                                 |
| REQ-003     | SCN-LOGIN-010 | Negative | P2       | username retained after failure            |

## Step 7 — Review notes (pending human)

All generated tests: **PENDING** human KEEP/MODIFY/REJECT until live verification.
