# Qali

**Qali** is a Slack-first autonomous QA orchestration system. Developers ask for tests or exploration in plain language; Qali runs governed workflows behind the scenes and reports back with compact Slack summaries and expandable detail.

Playwright is the source of deterministic truth. AI agents explore, generate, and maintain tests — but never silently weaken assertions, skip failures, or promote unverified knowledge.

## Start here

- [User guide](docs/user-guide.md) — what Qali does, how teams use it, setup, outputs, and FAQ
- [Developer and operator guide](docs/developer-guide.md) — architecture, harness, security, deployment, and troubleshooting
- [Implementation and readiness status](docs/current-status.md) — what is complete, partial, blocked, and still awaiting live proof
- [Slack agent UX review](docs/slack-agent-ux-review.md) — official Slack guidance and a prioritized interface roadmap

## What developers get

- **Lazy Slack interface** — free-form requests like “explore login” or “run the dashboard suite”
- **Essentials first** — short pass/fail summaries with buttons to expand or open full reports
- **Proactive QA** — exploration, test generation, scheduled runs, and failure triage without micromanagement
- **Auditable changes** — generated artifacts are committed through a controlled publication path, not silent direct pushes

## Architecture (at a glance)

```
Slack → Cloudflare Worker (intake, roles, dedupe, D1)
      → GitHub Actions (workflows, Playwright, agents)
      → Controlled publication (Qali branch → ready review PR)
      → Slack callback (compact summary + links)
```

See [docs/architecture.md](docs/architecture.md) for the full control plane / execution plane split.

## Local quick start — `[MOCK MODE]`

The reviewed Slack, Cloudflare, GitHub Actions, and deterministic execution path has been deployed and exercised against the demo project. The self-contained local demo remains the fastest way to verify the vertical slice without external credentials. See the [readiness status](docs/current-status.md) before treating any individual workflow as live-verified.

```bash
npm ci
npm run check          # format, lint, build, unit tests
npm run demo:test      # Playwright against projects/_demo
npm run demo:loop      # explore → generate → run → report (Mock Mode)
```

The demo uses a local Node mock app (`projects/_demo/app/`) — no external credentials required.

## Project scaffolding

```bash
# Validate the demo project layout and governance
npm run project:validate -- projects/_demo

# Copy projects/_template/ to projects/<your-project>/ and fill sources/
```

Each project follows **source → observation → derived** ownership:

| Layer           | Purpose                                   | Who writes                          |
| --------------- | ----------------------------------------- | ----------------------------------- |
| `sources/`      | Governed product facts, risks, decisions  | Humans/reviewers                    |
| `observations/` | Explored behavior, evidence, failures     | Qali with provenance                |
| `derived/`      | Scenarios, reports, tasks, workflow state | Qali through controlled publication |
| `tests/`        | Playwright specs from approved scenarios  | Qali through controlled publication |

See [docs/project-template.md](docs/project-template.md).

## Roles

| Slack role                                   | Can request                                                            | Cannot                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| **Developer** (default)                      | Exploration, generate/run suites, triage, quality pulse                | Change autonomy, policy, authority, maintenance workflows |
| **QA Lead/Admin** (`SLACK_QA_LEAD_USER_IDS`) | Everything above plus knowledge/suite maintenance and policy workflows | —                                                         |

Internal runtime roles (Intake Planner, Explorer, Test Generator, etc.) are invisible to Slack users — they enforce permissions inside workflows.

## Workflows

Machine-readable YAML under `workflows/` defines what Qali does for each intent: exploratory testing, generate test suite, run test suite, triage, maintenance, quality pulse, and onboarding. Users never edit these directly.

## Production guardrails

- **No preview URL** — Qali tests the configured environment (currently production-only for target projects). PR preview testing is not assumed.
- **Controlled publication** — generated changes never push directly to `main`; they go through `qali/*` branches and ready-for-review PRs.
- **Unsafe mutations blocked** — assertion weakening, visual baseline updates, test deletes/skips, and authority changes require human publication.

See [docs/autonomy-and-security.md](docs/autonomy-and-security.md) and [docs/setup-slack.md](docs/setup-slack.md).

## Live control plane (optional)

Local Mock Mode needs no Cloudflare. To wire Slack + Worker + Actions:

```bash
npx wrangler login
npm run control-plane:provision
# fill .env from .env.example, then:
npm run control-plane:sync-secrets
npm run control-plane:deploy
npm run control-plane:render-slack-manifest
```

`control-plane:sync-secrets` reads `.env` and syncs:

- **Cloudflare Worker** secrets (Slack + GitHub App)
- **GitHub Actions** secrets/vars (`CURSOR_API_KEY`, `CURSOR_MODEL` default `composer-2.5`, `QALI_CALLBACK_SECRET`, `QALI_WORKER_BASE_URL`, optional publish token)

Scoped sync examples: `--only slack`, `--only github`, `--only actions`, `--only cursor`.

Then create the Slack app from the env-resolved `apps/slack-worker/slack-app-manifest.local.json` (see [docs/setup-slack.md](docs/setup-slack.md)). The committed `slack-app-manifest.json` stays generic.

## Setup guides

- [Implementation plan](docs/plan.md) — authoritative MVP scope and acceptance criteria
- [Origin context](docs/origin-context.md) — product decisions and how to continue work
- [Cloudflare Worker (D1, Queue, AI)](docs/setup-cloudflare.md)
- [Slack app manifest](docs/setup-slack.md)
- [GitHub App + Actions](docs/setup-github.md)
- [Roadmap and phases](docs/roadmap.md)

## Skills

Qali inherits a curated subset of QA Garage skills (see `skills/catalog.json`). **Migrated skills** cover project context, exploration, Playwright automation, visual testing, test generation, bug triage, and suite maintenance. **Deferred skills** (accessibility, CI/CD integration, contract testing, coverage analysis, release readiness, and others) ship in later phases — see [docs/roadmap.md](docs/roadmap.md).

## License

MIT
