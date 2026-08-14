# Roadmap

## 2-day MVP (this repository)

Delivered and verified locally against the `_demo` fixture (historical 2-day MVP). Live Slack now targets Sauce Demo (`projects/sauce-demo`); see [current-status.md](current-status.md).

| Feature                                                               | Status |
| --------------------------------------------------------------------- | ------ |
| TypeScript monorepo with contracts, knowledge, orchestrator           | Done   |
| Governed project template + `_demo` mock target                       | Done   |
| Workflow catalog (explore, generate, run, triage, maintenance, pulse) | Done   |
| Slack control plane scaffold (Worker, D1, Queue, GitHub dispatch)     | Done   |
| Playwright functional + visual evidence                               | Done   |
| Cursor CLI agent adapter                                              | Done   |
| Compact Slack reporting                                               | Done   |
| External roles (Developer / `#qali-ops` break-glass)                  | Done   |
| Controlled publication policy + GitHub adapter                        | Done   |
| Documentation and `.env.example`                                      | Done   |

Verified commands:

```bash
npm run check
npm run demo:test
npm run demo:loop
```

**Not deployed:** live Slack, Cloudflare, GitHub App, or Cursor in CI from the authoring environment. Wire credentials per setup guides to go live.

## Phase 2 (+2 days) — live integration hardening

- Deploy Worker to Cloudflare with real Slack app
- Wire GitHub App dispatch and publication token
- End-to-end Slack → Actions → Slack callback on `sauce-demo`
- PR comment / check run integration for feature branches
- Scheduled nightly quality pulse to Slack channel
- Basic operator dashboard (workflow state + last run)

## Phase 3 (+2 days) — self-improvement loop

- Suite maintenance workflow with equivalent repair auto-publication
- Selector drift recovery from failure evidence
- Knowledge curator scheduled runs (promote observations → sources with authority)
- Coverage map drift alerts
- Optional review toggle before auto-merge (default: merge)

## Phase 4 — integrations and breadth

- Linear issue filing from triage (lower priority)
- PostHog quality signals in quality pulse (lower priority)
- Cross-browser matrix from analytics
- Accessibility testing (`accessibility-testing` skill)

## Migrated skills (MVP)

From QA Garage / qa-skills, bound in `skills/catalog.json`:

- qa-project-context, qa-start, qa-project-bootstrap
- journey-mapping, risk-based-testing, test-strategy, test-planning
- exploratory-testing, agentic-browser-testing
- playwright-automation, ai-test-generation, visual-testing
- test-data-management, bug-reproduction, ai-bug-triage
- test-reliability, selector-drift-recovery, qa-report-humanizer

## Deferred skills (post-MVP)

Planned but not migrated yet:

- accessibility-testing
- ci-cd-integration
- contract-testing
- coverage-analysis
- cross-browser-testing
- database-testing
- ai-system-testing
- release-readiness
- shift-left-testing
- test-environments
- qa-metrics, qa-dashboard
- test-suite-curation

## Operational maturity (later)

| Area            | MVP                        | Target                         |
| --------------- | -------------------------- | ------------------------------ |
| Retention       | 14-day artifact retention  | Configurable per project       |
| Cost            | Free-tier Cloudflare + GHA | Usage alerts                   |
| Audit           | PR + workflow state        | Searchable run history         |
| Troubleshooting | Setup docs                 | Runbook + Slack `/qali status` |

## Known limitations

- **No preview URL** — tests target configured production URL
- **Single browser** — Chromium in CI
- **Intent classifier** — Workers AI in prod; keyword fallback not shipped
- **Self-healing** — policy exists; full maintenance loop in Phase 3
- **Human review toggle** — auto-merge default; optional gate in Phase 3
