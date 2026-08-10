<!-- qali:generated owner=qali sha256=30ffbea1cd9a998b9bf8850dfb433155a3e37d3819edca6a8794c3b07a302dd0 -->

# Demo smoke and visual scenario

- Status: approved for automation
- Approval source: repository maintainer request to implement `build-agent-execution`
- Approval date: 2026-08-10
- Authoritative sources: `sources/reference/requirements.md`, `sources/reference/journeys.md`, `sources/reference/test-data.md`
- Target: local mock server only

## DEMO-SMK-001: Seeded customer reaches dashboard

- Traceability: REQ-001, REQ-003, REQ-005, JRN-001, DATA-001, DATA-002
- Given the local demo is available
- When the seeded customer signs in
- Then the dashboard identifies Alex Morgan, shows the seeded balance and activity, and retains the `MOCK MODE` badge

## DEMO-SMK-002: Invalid credentials are rejected

- Traceability: REQ-002, REQ-005, JRN-002
- Given the local demo is available
- When a visitor submits non-seeded credentials
- Then an accessible error is announced, the dashboard remains hidden, and the `MOCK MODE` badge remains visible

## DEMO-VIS-001: Dashboard evidence capture

- Traceability: REQ-003, REQ-005, JRN-001
- Capture a full-page dashboard screenshot as run evidence.
- No visual baseline is approved in this slice. Baseline creation remains an explicit human-approved action and must use the same container/browser environment as CI.
