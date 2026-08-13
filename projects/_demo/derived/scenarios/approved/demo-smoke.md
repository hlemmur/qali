<!-- qali:generated owner=qali sha256=ca9a7c24185a12988149b900fbd7dfa14e5c23159614e38d46f3900541878f01 -->

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

```json qali-playwright
{
  "path": "/",
  "actions": [
    { "kind": "fill", "label": "Email", "value": "alex@example.test" },
    { "kind": "fill", "label": "Password", "value": "demo123" },
    { "kind": "click", "role": "button", "name": "Sign in" }
  ],
  "assertions": [
    { "kind": "visible", "role": "heading", "name": "Good morning, Alex Morgan" },
    { "kind": "text", "testId": "balance", "value": "$12,480.50" }
  ]
}
```

## DEMO-SMK-002: Invalid credentials are rejected

- Traceability: REQ-002, REQ-005, JRN-002
- Given the local demo is available
- When a visitor submits non-seeded credentials
- Then an accessible error is announced, the dashboard remains hidden, and the `MOCK MODE` badge remains visible

```json qali-playwright
{
  "path": "/",
  "actions": [
    { "kind": "fill", "label": "Email", "value": "intruder@example.test" },
    { "kind": "fill", "label": "Password", "value": "wrong" },
    { "kind": "click", "role": "button", "name": "Sign in" }
  ],
  "assertions": [{ "kind": "visible", "role": "alert", "name": "Email or password is incorrect." }]
}
```

## DEMO-VIS-001: Dashboard evidence capture

- Traceability: REQ-003, REQ-005, JRN-001
- Capture a full-page dashboard screenshot as run evidence.
- No visual baseline is approved in this slice. Baseline creation remains an explicit human-approved action and must use the same container/browser environment as CI.

```json qali-playwright
{
  "path": "/",
  "actions": [
    { "kind": "fill", "label": "Email", "value": "alex@example.test" },
    { "kind": "fill", "label": "Password", "value": "demo123" },
    { "kind": "click", "role": "button", "name": "Sign in" }
  ],
  "assertions": [{ "kind": "evidenceScreenshot", "name": "dashboard-run-evidence.png" }]
}
```
