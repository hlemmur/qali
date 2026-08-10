# QA Project Context

## Product

- CTX-001 | Qali Demo is a local mock banking portal used to exercise login and dashboard QA workflows. | confirmed | repository demo contract | 2026-08-10
- CTX-002 | The critical journey is signing in as the seeded customer and reviewing account balances and activity. | confirmed | JRN-001 | 2026-08-10

## Tech Stack

- CTX-003 | The demo uses a Node HTTP server and static HTML, CSS, and browser JavaScript with no external integration. | confirmed | app/server.mjs | 2026-08-10

## Test Stack

- CTX-004 | Vitest validates project structure; later browser tests may target the local server. | confirmed | package.json | 2026-08-10

## CI/CD

- CTX-005 | Repository checks run formatting, linting, TypeScript, and Vitest. | confirmed | package.json | 2026-08-10

## Environments

- CTX-006 | Run `node projects/_demo/app/server.mjs`; the default URL is `http://127.0.0.1:4173`. | confirmed | app/server.mjs | 2026-08-10

## Quality Goals

- CTX-007 | Login, invalid credentials, dashboard data, logout, and mock-mode visibility are critical. | confirmed | REQ-001..REQ-005 | 2026-08-10

## Risk Areas

- See `reference/risks.md`.

## Team

- CTX-008 | The repository maintainer is product authority and QA lead for this synthetic target. | confirmed | repository demo contract | 2026-08-10

## Conventions

- CTX-009 | Use stable element IDs, seeded data IDs, and deterministic local behavior. | confirmed | app/public/index.html | 2026-08-10
