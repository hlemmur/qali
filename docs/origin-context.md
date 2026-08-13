# Origin context

Summary of product intent and decisions from the Qali design session. Use this when continuing work inside the Qali workspace without the original chat history.

## Why Qali exists

Qali replaces the IDE-only QA Garage prototype with a **Slack-first, autonomous QA system** for a startup dev team. The team wanted:

- Minimal surface area — essentials in Slack, details on demand
- No micromanagement — proactive, autonomous, sane behavior
- No manual QA harness maintenance — self-maintaining knowledge and suites
- E2E frontend focus with Playwright and visual testing
- A presented solution, not a parts kit — tailored MVP with phased expansion

The QA expert (plan author) insisted on:

- Human-in-the-loop when needed, but **Qali authors governed sources by default**
- Standardized md/json artifacts, no duplication, derived files auto-updated
- Shift-left QA as a later phase
- Full audit trail of harness and project changes
- Hidden but deterministic workflows — users ask in free form; Qali routes internally

## Relationship to QA Garage

|           | QA Garage             | Qali                               |
| --------- | --------------------- | ---------------------------------- |
| Interface | Cursor IDE agent      | Slack bot                          |
| Execution | Local / IDE           | GitHub Actions + Cloudflare Worker |
| Audience  | QA engineer in editor | Developers in Slack                |
| Status    | Prototype, unchanged  | Production-shaped MVP scaffold     |

Qali **selectively migrates** governance, skills, templates, and validators from QA Garage. It does not copy IDE adapters, placeholder tests, or prototype clutter. See [plan.md](plan.md).

## Key architectural decisions

1. **Monorepo** — TypeScript npm workspaces; packages for contracts, knowledge, orchestrator, agents, Playwright, reporting, publication.
2. **Control vs execution plane** — Cloudflare Worker for fast Slack intake; GitHub Actions for long Playwright/agent runs.
3. **Knowledge model** — `sources/` → `observations/` → `derived/` with strict ownership and provenance.
4. **Internal roles** — Nine permission-scoped runtime profiles; invisible to Slack users.
5. **External roles** — Developer (default) vs QA Lead/Admin (`SLACK_QA_LEAD_USER_IDS`).
6. **Autonomy** — `conservative` / `balanced` / `autonomous`; demo uses `autonomous` with hard semantic safety rules.
7. **Publication** — Safe generated changes via `qali/*` branch → PR → auto-merge; never direct push to `main`.
8. **Local fixture** — `projects/_demo` + `npm run demo:loop` for credential-free Vitest/local proof. Live Slack target is Sauce Demo (`projects/sauce-demo`).

## Confirmed environment assumptions

These were answered during planning for the **target startup** (not required for the generic scaffold):

| Question                 | Answer                                                            |
| ------------------------ | ----------------------------------------------------------------- |
| Slack workspace          | Start on author's free Slack for experiments                      |
| Preview URLs on PRs      | Probably not every PR                                             |
| Test environment         | Production only for now                                           |
| Test login               | Existing test login in target project                             |
| Top broken journeys      | Qali discovers in operational mode                                |
| Qali may open issues/PRs | Yes, from collected evidence                                      |
| Linear / PostHog         | Lower priority; defer                                             |
| Self-healing             | Not silent; commit/merge by default; optional review toggle later |

## Agent naming

The agent is **Qali** (QA + Kali reference).

## Implementation execution model

Work was delivered in vertical slices with TDD:

1. Subagents implemented slices without committing
2. Parent agent reviewed and committed each green slice
3. Final `document-roadmap` slice (roles, publication, docs) was completed in one commit after parent review

## Current status (post-MVP)

**Done locally:**

- All 8 plan todos complete
- 98 unit/integration tests passing
- Playwright demo (4 tests) passing
- Full Mock Mode loop (`demo:loop`) passing
- Wrangler dry-run OK
- Documentation in `docs/` and root `README.md`

**Not done:**

- No git remote configured (as of initial handoff)
- Live Slack app, Cloudflare deploy, GitHub App wiring, Cursor CLI in CI
- Phase 2+ features in [roadmap.md](roadmap.md)

## How to continue

1. Read [README.md](../README.md) and [plan.md](plan.md)
2. Run `npm run check` to verify workspace health. `npm run demo:loop` is the local `_demo` fixture, not the Slack path.
3. Pick next item from [roadmap.md](roadmap.md) and [current-status.md](current-status.md)
4. For target-project onboarding, scaffold from `projects/_template/` and follow [project-template.md](project-template.md)
5. When changing governance or workflows, keep `documentation-assets.test.ts` and workflow YAML validators green

## Useful commands

```bash
npm run check              # format, lint, build, unit tests
npm run project:validate -- projects/sauce-demo
npm run demo:test          # Playwright against the local _demo fixture
npm run demo:loop          # credential-free local fixture sequence
npm run execute            # run workflow from COMMAND_JSON env
npm run publish:prepare    # build publication manifest from git diff
```
