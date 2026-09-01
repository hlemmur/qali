# Official ADK recipe study

Date: 2026-09-01

Source: `google/adk-samples` at revision `cf7cadbc537cab9a6105a9b9adf5a2af2da43061`.

This study is the Phase 1 design gate for Qali v2. It records the implementation patterns we will reuse, the parts we will adapt, and the sample-specific infrastructure we will not carry into the private MVP. The recipes are references, not dependencies; Qali will implement its own narrow contracts and tests.

## Decision summary

| Qali concern | Recipe pattern | Decision |
| --- | --- | --- |
| Slack ingress and deferred work | `ambient-expense-agent` acknowledges an event-driven trigger before long-running or human work completes | Reuse the separation. Qali's signed Slack ingress will validate, enqueue exactly one typed job, and return within Slack's deadline. A separate worker owns the workflow. Use Cloud Tasks rather than copying the Pub/Sub-specific endpoint. |
| Deterministic workflow | `ambient-expense-agent` keeps routing rules in function nodes and uses an LLM only for judgment | Reuse. Typed code owns authorization, idempotency, state transitions, policy, and publication. The model cannot invent workflow routes. |
| Global safety | `safety-plugins` attaches a `BasePlugin` to the runner so every agent and sub-agent is covered | Reuse the runner-wide lifecycle boundary. Implement deterministic input, tool, output, redaction, and iteration controls and test every hook. |
| Session poisoning | `safety-plugins` replaces blocked content before persistence and halts the invocation | Reuse. Persist a redacted rejection record, never the unsafe or secret-bearing payload. |
| Browser/tool boundary | `long-horizon-harness` places tool execution behind an environment interface and an ordered guard chain | Adapt to a narrow Playwright MCP facade. Qali will not expose a general shell or host filesystem to runtime agents. Guard order is a tested contract. |
| Credentials | `long-horizon-harness` hides values behind a `SecretStore` protocol and injects them only at execution | Adapt to manually provisioned Secret Manager references. Models see secret names only. Resolution or injection failure must fail closed; Qali will not copy the sample's empty-environment fallback. |
| Specialist isolation | `long-horizon-harness` gives delegated children isolated context and bounded execution envelopes | Adapt to named, typed specialists invoked only by the coordinator's fixed workflow. No model-selectable background fleet, dynamic toolsets, or free-form delegation in the MVP. |
| Prompt construction | `long-horizon-harness` separates constant, project-context, and volatile prompt tiers | Reuse. Keep stable policy/instructions separate from compiled project knowledge and per-run state. Never place secrets or untrusted source text in the constant policy tier. |
| Cross-session knowledge | `cross-session-memory` makes write and recall explicit and tests the wiring separately | Adapt to Firestore and GCS. Project knowledge is an authorized, cited artifact with explicit compile/read paths, not unconstrained conversational memory. |
| Durable verification | The memory recipe's tests use in-memory services and do not prove recall across sessions or restarts | Strengthen. Qali requires restart, cross-thread, tenant-isolation, stale-version, and retention tests against durable adapters before qualification. |

## Recipe notes

### `core/python/ambient-expense-agent`

Files studied:

- `AGENTS.md`
- `expense_agent/fast_api_app.py`
- `expense_agent/agent.py`
- `tests/test_integration.py`

Reusable ideas:

- Treat the public HTTP response as transport acknowledgment, not proof the workflow completed.
- Put schemas and routing in code, pass typed state between nodes, and make pending human work discoverable from durable workflow state.
- Exercise trigger-to-pause-to-resume behavior through an in-process HTTP integration test.

Deliberate deviations:

- Qali accepts signed Slack events and creates Cloud Tasks; it does not expose the recipe's ADK Pub/Sub trigger.
- Qali stores jobs and idempotency records durably. The recipe's in-memory sessions can lose pending work on restart.
- Slack thread updates replace the separate approval web UI for the private MVP.
- Project-specific thresholds and entities never enter Qali's core routing code.

### `core/python/safety-plugins`

Files studied:

- `AGENTS.md`
- `safety_plugins/plugins/agent_as_a_judge.py`
- `safety_plugins/plugins/model_armor.py`
- `safety_plugins/main.py`

Reusable ideas:

- Attach cross-cutting controls once at the runner so nested specialists cannot bypass them.
- Sanitize a rejected user message before session persistence, then halt before the model runs.
- Guard tool inputs and outputs in addition to model responses.

Deliberate deviations:

- The private MVP will not make a second Gemini call for each safety decision; that would consume scarce free quota and add a fallible model to a mandatory boundary.
- Model Armor is deferred because it needs a configured paid/regional service and does not cover tool inputs in the sample.
- Deterministic schema, signature, authorization, prompt-injection, secret-redaction, action-policy, and output-validation controls are mandatory. An optional classifier may supplement them later but may not weaken them.
- Qali will add direct safety-plugin tests; the sample's tests do not exercise its plugins.

### `core/python/long-horizon-harness`

Files and sections studied:

- `AGENTS.md`
- `docs/architecture.md`: construction, execution, extension interfaces, and composed applications
- `docs/security-model.md`: invariants, hard-deny versus ask, credential injection, and threat boundaries
- `horizon/environment/base.py`
- `horizon/environment_context.py`
- `horizon/secrets/store.py`
- `horizon/secrets/inject.py`
- `horizon/subagents/subagent.py`
- `horizon/subagents/delegate_runner.py`
- `horizon/conversation/system_prompt.py`: static-instruction and context-tier builders

Reusable ideas:

- Runtime capabilities live behind small interfaces selected outside model reasoning.
- Ordered callbacks form an explicit security contract: hard-deny checks precede any human-confirmation layer.
- Secret values are resolved only at the execution boundary; prompts expose names, not values.
- Isolated child contexts return explicit `completed`, `pending`, `timeout`, or `halted` envelopes, and incomplete work cannot be reported as complete.
- Stable, project, and volatile prompt tiers have different trust and lifecycle rules.

Deliberate deviations:

- Qali's runtime environment is a deny-by-default Playwright MCP facade, not a general sandbox, shell, process manager, scheduler, or dynamic skill host.
- Qali uses a fixed specialist graph and typed task/result schemas instead of one general `subagent` tool.
- Secret lookup errors block the dependent operation and create a redacted audit event. They do not silently continue with an empty environment.
- Vertex Sandboxes, Agent Platform Sessions, Memory Bank, routines, self-improvement, dynamic skill reload, OAuth, and model routing are outside the private free-first phase.
- Human confirmation may authorize a specific consequential operation; it never overrides forbidden actions, tenant boundaries, origin restrictions, or secret-exfiltration controls.

### `core/python/cross-session-memory`

Files studied:

- `AGENTS.md`
- `app/agent.py`
- `app/fast_api_app.py`
- `tests/integration/test_agent.py`
- `tests/integration/test_server_e2e.py` test inventory

Reusable ideas:

- Make knowledge write and recall paths explicit and independently observable.
- Separate deterministic wiring tests from live behavioral evaluation.
- Namespace persisted context by owner and project, and declare what kinds of information may persist.

Deliberate deviations:

- Qali uses Firestore for typed project/job/session metadata and GCS for versioned source, knowledge, and evidence artifacts.
- It does not create or reuse Agent Engine from application startup.
- It compiles only approved onboarding sources into cited project knowledge; it does not automatically promote arbitrary conversation content into durable memory.
- Local mock mode uses compatible in-memory adapters, but qualification must prove the durable adapters across process restart and a new Slack thread.

## First tracer-bullet consequences

The first implementation slice must demonstrate this sequence without calling Gemini:

1. Verify the Slack signature, timestamp window, designated channel, and allowed owner.
2. Derive a stable event idempotency key and atomically create exactly one `onboard_project` job.
3. Enqueue only the job identifier and authorized routing metadata.
4. Return the Slack HTTP acknowledgment within the deadline.
5. Let the worker load the typed job, publish a same-thread progress update, and stop at a deterministic pre-model boundary in the initial red test.

The tests must distinguish HTTP acknowledgment, durable job creation, task dispatch, and visible Slack progress. A `200` response alone is not success.

## Phase 1 exit decision

Phase 1 passes. The official recipes provide applicable patterns, and every material deviation is recorded above. Scaffolding may begin only after the scaffold skill is loaded, `agents-cli info` is run, missing local tooling is installed, and the free-tier model choice is verified against the current eligible-model list.
