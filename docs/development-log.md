# Development log

## 2026-09-01 — Phase 1: official ADK recipe study

Isolated change: completed the mandatory pre-scaffold study and recorded Qali-specific reuse and deviation decisions in [reference-recipe-study.md](reference-recipe-study.md).

Reason: the approved implementation plan requires code-level study of matching official recipes before Agents CLI scaffolding or application code.

Skills and guidance:

- `google-agents-cli-workflow` 1.4.2
- `google-agents-cli-adk-code` 1.4.2
- `tdd`
- `google-agents-cli-adk-code/references/samples.md`

Official source:

- Repository: `google/adk-samples`
- Revision: `cf7cadbc537cab9a6105a9b9adf5a2af2da43061`
- Recipes: `long-horizon-harness`, `ambient-expense-agent`, `safety-plugins`, and `cross-session-memory`

Commands and evidence:

- Cloned the official repository into a temporary sparse checkout at the pinned revision.
- Read every selected recipe's `AGENTS.md` and the exact implementation files listed in the study record.
- Compared each pattern with the approved [.agents-cli-spec.md](../.agents-cli-spec.md) and [QALI_V2_IMPLEMENTATION_PLAN.md](../QALI_V2_IMPLEMENTATION_PLAN.md).
- Produced the reuse/adapt/reject matrix and first tracer-bullet consequences in [reference-recipe-study.md](reference-recipe-study.md).

Deviations:

- Replaced Pub/Sub-specific ambient ingress with signed Slack ingress plus Cloud Tasks.
- Replaced paid LLM-judge and Model Armor safety dependencies with deterministic mandatory controls for the private free-tier phase.
- Replaced Agent Engine Sessions and Memory Bank with Firestore and GCS durability.
- Narrowed the long-horizon environment and delegation patterns to a typed specialist workflow and deny-by-default Playwright MCP facade.
- Strengthened secret resolution to fail closed and required restart/cross-thread durability tests absent from the reference recipes.

Phase result: passed. No application scaffold, cloud resource, deployment, or external integration was changed during this phase. `agents-cli` and `uv` remain prerequisites for Phase 2.

## 2026-09-01 — Phase 2: prototype scaffold

Isolated change: installed the required local tooling, generated the Agents CLI ADK prototype in the existing Qali repository, and reconciled generated configuration with the approved private free-first architecture.

Reason: preserve the supported ADK, FastAPI, A2A, Docker, dependency, test, and eval conventions before implementing Qali behavior.

Skills and tools:

- `google-agents-cli-scaffold` 1.4.2
- `google-agents-cli-workflow` 1.4.2
- `tdd`
- `uv` 0.12.8
- `google-agents-cli` 1.4.2
- generated `google-adk>=2.6.0,<3.0.0`

Commands and evidence:

- Ran `agents-cli info` before scaffolding; it reported no agent project.
- Ran `agents-cli scaffold enhance . --prototype --agent-directory app --agent-guidance-filename AGENTS.md`.
- Ran `agents-cli install` and installed the declared lint extra.
- Verified `agents-cli info` recognizes project `qali`, agent directory `app`, A2A enabled, and deployment target `none`.
- Verified `4` unit tests pass.
- Verified `agents-cli lint` passes Ruff, Ruff format, codespell, and ty.
- Verified all `4` generated integration tests import and collect without executing their live Gemini calls.
- Verified the generated `gemini-3.7-flash` model against Google's current Gemini Developer API pricing page, which lists free-tier input and output.

TDD evidence:

- Red: the scaffold configuration tests exposed `base_template: local_qali`, `region: us-east1`, and Vertex mode in `.env.example`.
- Green: corrected the manifest to base `adk` and region `europe-west1`, and made the local example use the Gemini Developer API with project `qali-507317`.
- Red: the full lint gate scanned the separate `.agents` catalog and attempted to reformat reference snippets.
- Green: configured Ruff, ty, and codespell to exclude `.agents`; the full gate then passed without mutating the catalog.

Deviations and limitations:

- Agents CLI first failed inside the filesystem sandbox because Cookiecutter and backup metadata live under the user directory. The same approved command succeeded with access to those paths and created a local backup.
- Agents CLI 1.4.2 recorded the current repository as `local_qali` instead of its actual inherited `adk` base. That broke a later scaffold dry run, so the manifest metadata was corrected and protected by a unit test.
- The generated integration tests call the configured model. They were collected but not executed; the first feature slice must introduce explicit mock-mode integration coverage before any live-model test runs.
- Google's current free-tier terms say submitted content may be used to improve its products. The spec and plan now restrict free-tier calls to public, synthetic, or explicitly non-sensitive test data.
- GCP authentication, cloud resources, Slack secrets, Gemini API key provisioning, deployment, and live model usage remain untouched.

Phase result: passed for scaffolding and local deterministic validation. Phase 3 may begin after reloading the ADK-code and TDD guidance and inspecting the installed ADK signatures required by the first tracer bullet.
