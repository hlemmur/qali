# QA Project Context

> Qali-authored governed source. Record durable facts once and reference their IDs elsewhere.
> Convention: `ID | statement | status | source | date` where status is confirmed, observed, inferred, unknown, or outdated.

## Product

- CTX-001 | Sauce Demo is a public Sauce Labs sample store used to exercise login, inventory, cart, and checkout. | inferred | https://www.saucedemo.com | 2026-08-13
- CTX-002 | The live target URL is `https://www.saucedemo.com`. | confirmed | D-002 | 2026-08-13

## Tech Stack

- CTX-003 | The public site is a static storefront with a username/password login form. Hosting and backend details are out of scope for black-box E2E. | inferred | https://www.saucedemo.com | 2026-08-13

## Test Stack

- CTX-004 | Qali owns Playwright checks in this repository after scenarios are approved. No customer git is required. | confirmed | D-002 | 2026-08-13

## CI/CD

- CTX-005 | Slack work runs in GitHub Actions environment `qali-sauce-demo`. | confirmed | D-002 | 2026-08-13

## Environments

- CTX-006 | There is no local mock of Sauce Demo. Qali hits the public production demo origin only. | confirmed | D-002 | 2026-08-13

## Quality Goals

- CTX-007 | First live proof is login → inventory → cart on Chromium against the public demo. | confirmed | D-002 | 2026-08-13

## Risk Areas

- See `reference/risks.md`; do not duplicate scored risks here.

## Team

- CTX-008 | Qali is the E2E QA teammate. Humans resolve product-truth disputes and named-credential setup. | confirmed | D-002 | 2026-08-13

## Conventions

- CTX-009 | Durable facts use IDs, provenance, source dates, and evidence statuses. | confirmed | core/policies/evidence-and-provenance.md | 2026-08-13
- CTX-010 | Generated artifacts under `derived/` are Qali-owned and must be regenerated, not hand-edited. | confirmed | sources/autonomy-policy.md#AUT-003 | 2026-08-13
- CTX-011 | Test credentials are named fills from GitHub Environment secrets and must never be committed or echoed. | confirmed | D-003 | 2026-08-13
