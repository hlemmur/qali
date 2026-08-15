# Exploration Log

> Append-only observations. Observation IDs describe what happened and never define expected behavior.

| ID      | Observation                        | Status  | Evidence | Observed at | Session |
| ------- | ---------------------------------- | ------- | -------- | ----------- | ------- |
| OBS-001 | No exploration has been performed. | unknown | —        | 2026-08-13  | —       |

# QA Session — Sauce Demo Login Flow (Deep)

- Project: sauce-demo
- Target / environment: https://www.saucedemo.com (public production demo; CTX-006)
- Date: 2026-08-15
- Operator / tool: explorer / qali-browser (browser facade)
- Charter: Explore Sauce Demo **login flow** with named demo credentials (DATA-001, DATA-002), invalid and locked-account variants, and HICCUPS / FEW HICCUPS heuristics to discover requirement gaps, authentication edge cases, error-handling weaknesses, and session-boundary defects.
- Generation request: Ev0BPYC580UX
- Account / role: explorer (append-observation, append-evidence)
- Mock mode: off

## Observations

| Time (UTC)        | Tag      | Action                   | Observation                                                                                                                                                                                                                | Evidence    |
| ----------------- | -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2026-08-15T00:42Z | NOTE     | Read governed inputs     | Project context, reference (requirements, journeys, test-data, risks), and known-issues loaded from `inputs/`. Charter focus: login flow, depth deep.                                                                      | EVD-EXP-001 |
| 2026-08-15T00:43Z | RISK     | Attempt browser session  | `qali-browser` MCP server is not registered in the harness session (only Cloudflare docs and Slack plugin servers visible). Live navigation, snapshot, and form interaction could not start.                               | EVD-EXP-001 |
| 2026-08-15T00:43Z | QUESTION | Environment gate         | Is the browser facade expected to mount via `.cursor/mcp.json` → `qali-browser` in this profile? Harness manifest lists `browser` tool but runtime catalog does not expose it.                                             | EVD-EXP-001 |
| 2026-08-15T00:43Z | NOTE     | Planned probes (blocked) | Charter probes 1–25 (happy path JRN-001, invalid/locked accounts per REQ-003, input boundaries, session/URL boundaries, security posture, accessibility, viewport/network) remain unexecuted pending browser availability. | —           |

Tags: `BUG`, `QUESTION`, `IDEA`, `RISK`, `NOTE`.

## Debrief

- Coverage: **unexplored** (live login UI not reached)
  - Happy path (REQ-001 / JRN-001): unexplored
  - Invalid credentials (REQ-003): unexplored
  - Locked account (REQ-003): unexplored
  - Session / URL boundaries: unexplored
  - Accessibility & keyboard: unexplored
- Reproduced findings: none (browser unavailable)
- Suspected findings: none (no live evidence)
- Non-issues: none confirmed
- Knowledge updates:
  - OBS-EXP-001 | Browser MCP (`qali-browser`) was unavailable at session start; exploration blocked before first navigation. | observed | EVD-EXP-001 | 2026-08-15
- Open questions:
  - Q-EXP-001 | How should the harness mount `qali-browser` for `browser-exploration` profile runs? | unknown | EVD-EXP-001 | 2026-08-15
- Follow-up:
  - Re-run explore step once `qali-browser` MCP is available; execute charter probes 1–25 against https://www.saucedemo.com
  - After happy-path confirmation, consider graduating JRN-001 to scripted regression per agentic-browser-testing skill

## Requirement traceability (intent only — not verified live)

| Requirement | Charter probe IDs | Live status |
| ----------- | ----------------- | ----------- |
| REQ-001     | 1–3               | unexplored  |
| REQ-003     | 4–7               | unexplored  |

## Hypotheses (not falsified — session blocked)

- H1: Only DATA-001 with named password reaches inventory; other accounts blocked per REQ-003.
- H2: Error messages are stable enough for automation despite RSK-001.
- H3: Session boundary prevents unauthenticated inventory access via direct URL.
- H4: Failed login does not leave a partial authenticated state.
