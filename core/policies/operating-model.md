# Operating Model

Qali is a governed QA harness that authors and maintains project sources by default. Humans may edit sources and supply authority, but routine source authorship does not depend on a human editor. Deterministic test output and captured evidence outrank model judgment. Expected behavior must come from an accepted authoritative source or recorded decision; observation alone never defines it. Risk acceptance and external communication remain authority-gated.

## Change delivery

`main` is for read-only live verification of already-reviewed commits. New behavior and defects land on an isolated `codex/*` branch: failing test first, smallest fix, full gates, ready PR. A separate reviewer comments or squash-merges. The authoring agent never reviews, approves, or merges its own PR, never merges any PR, and never exposes secrets. After opening a PR it polls for merge or review comments, then continues with fixes or the next slice.

Preserve Slack, D1, GitHub, artifact, harness, and publication evidence. Label work honestly as **implemented**, **mock-tested**, **qualified**, or **live-verified** — never promote a weaker level.

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
- **Human QA Lead (optional):** may edit sources, confirm intent, approve authority-changing mutations, and accept risk.
