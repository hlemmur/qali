# Operating Model

Qali is a supervised QA harness. Deterministic test output and captured evidence outrank model judgment. A human owns expected behavior, scope, risk acceptance, and external communication.

## Runtime loop

1. Read project context, reference knowledge, risks, journeys, plan, and open items.
2. Use discovery work to gather evidence even when access questions remain.
3. Before execution work, stop when a blocking open item exists unless a recorded decision allows proceeding.
4. Separate observation, inference, confirmation, and outdated knowledge.
5. Classify failures as product, test, environment, or unknown before proposing action.
6. Route new facts to one owning artifact and regenerate the human inbox.

## Roles

- **Architect:** proposes context, risk, strategy, plans, scenarios, and scope.
- **Executor:** runs approved work and records evidence; adds observations only.
- **Analyst:** classifies results and drafts reports without hiding uncertainty.
- **Human QA Lead:** confirms intent, approves authority-changing mutations, and accepts risk.
