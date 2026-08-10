# User Journeys

## JRN-001: Review account activity

- Actor: seeded mock customer
- Goal: review balance and recent transactions
- Preconditions: local demo server is running
- Steps: open the app; enter DATA-001 credentials; submit; review dashboard; sign out
- Outcome: dashboard data is visible, then the sign-in form returns
- Requirement links: REQ-001, REQ-003, REQ-004, REQ-005
- Status: confirmed
- Source: repository demo contract
- Date: 2026-08-10

## JRN-002: Reject invalid credentials

- Actor: anonymous visitor
- Goal: learn that credentials are invalid without gaining access
- Preconditions: local demo server is running
- Steps: enter any non-seeded credentials; submit
- Outcome: an error is announced and dashboard stays hidden
- Requirement links: REQ-002, REQ-005
- Status: confirmed
- Source: repository demo contract
- Date: 2026-08-10
