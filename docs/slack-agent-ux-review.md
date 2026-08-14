# Qali Slack agent UX review

This review compares Qali's current Slack experience with Slack's official guidance for agents and with interaction patterns used by Linear. It is a product and interaction-design recommendation, not a claim that every Slack feature described below is already implemented.

## Executive recommendation

Qali already has the right foundation for a trustworthy Slack QA agent: it acknowledges work quickly, keeps run updates in a thread, shows compact results, exposes evidence links, enforces roles, and reports downstream publication failures honestly.

The largest opportunity is to evolve it from a bot that launches workflows into a recognizable Slack agent with a persistent control surface. The best next version would combine:

- conversational requests in a DM or channel mention;
- terse, progressive status in the originating thread;
- an App Home or agent container for active and historical work;
- explicit previews and confirmation for consequential changes;
- source-aware completion summaries that separate execution, validation, and publication;
- shortcuts that turn an existing Slack message into test or triage context.

## What Slack officially recommends

The following points are drawn from Slack's agent documentation. Qali-specific conclusions are presented separately in the next sections.

### Identity and expectations

Slack recommends that an agent identify itself transparently as AI and use a function-first name and description. Users should understand what it can do, what context it can access, and when it is acting on their behalf.

Implication for Qali: the app name, profile, welcome copy, and first response should say plainly that Qali is an AI-assisted QA orchestrator whose deterministic truth comes from Playwright and policy validators.

### Entry points and suggested prompts

Slack supports agent conversations, mentions, DMs, message shortcuts, App Home, and contextual suggested prompts. Its guidance favors a small set of short, actionable prompts that reflect the current context rather than a static wall of commands.

Implication for Qali: show two to four prompts such as “Explore this project,” “Run the smoke suite,” “Triage the latest failure,” or “What changed in quality?” based on the channel, mapped project, and last run.

### Progressive status and visible work

Slack recommends acknowledging work immediately and communicating progress with short, plain-language updates. Tool use should be understandable to the user rather than exposed as internal implementation detail.

Implication for Qali: replace a long-lived generic “queued” state with meaningful phases such as “Validating project configuration,” “Starting the test target,” “Exploring checkout,” “Checking generated artifacts,” and “Preparing a review PR.”

### Context and trust boundaries

Slack emphasizes respecting the context boundary of a DM, channel, or thread, using only information the agent is entitled to access, and making source use visible. Agents should not imply knowledge outside the conversation or workspace permissions.

Implication for Qali: each run summary should state the project, environment, originating channel or thread, and sources consulted. Imported messages should be treated as untrusted evidence, not instructions that can override Qali policy.

### Consequential actions

Slack recommends confirmations for meaningful writes or external actions, while avoiding unnecessary confirmation for harmless reads. A confirmation should describe what will happen before it happens.

Implication for Qali: exploration and test execution can start immediately when authorized; publishing tests, accepting visual baselines, changing governed knowledge, or changing authority should show a concise preview and require the appropriate approval.

### Completion, citations, and recovery

Slack recommends a useful completion recap with source references, direct links, and explanations for skipped or blocked steps. It also encourages feedback and recovery paths.

Implication for Qali: a terminal card should distinguish “tests passed,” “artifact validation passed,” and “publication failed” instead of collapsing them into one color. Failure cards should offer the next sensible action: retry, inspect evidence, triage, or request access.

### App Home and split-view agents

Slack's App Home and split-view agent surfaces are designed for persistent, multi-turn work. The agent container can expose conversation history, dynamic titles, and contextual prompts without flooding a channel.

Implication for Qali: channels should remain the collaborative notification surface, while App Home or the agent container becomes the personal QA control room.

## What Qali should keep

These current patterns align well with Slack guidance and should remain product invariants:

- Immediate acknowledgement after an authorized request.
- One originating message and one thread per run.
- Essentials-first result cards with expandable detail.
- Buttons only when they have a clear, honest effect.
- Links that open evidence without accidentally dispatching new work.
- Role and project allowlist enforcement before dispatch.
- Correlation across Slack, D1, GitHub Actions, artifacts, and publication.
- Honest terminal failure when execution succeeds but validation or publication fails.
- Human review for unsafe or governed mutations.

## Current experience gaps

The present app behaves primarily as a workflow dispatcher with threaded status cards. Compared with Slack's agent model, it lacks a richer persistent surface and some contextual interaction patterns:

- The Slack manifest does not yet present Qali as a full Slack agent with a split-view conversational container.
- App Home is not yet a dashboard for running, blocked, and completed QA work.
- Suggested prompts are not dynamically tailored to the mapped project or run state.
- Progress states are technically correct but too coarse for a long workflow.
- Completion language can be more specific about which stage failed.
- Existing messages can be turned into Qali work through **Test with Qali** and **Triage with Qali** message shortcuts (re-upload the Slack manifest after merge).
- Consequential publication does not yet have a Slack-native preview and approval ceremony.
- Users do not have lightweight “helpful / not helpful” feedback controls on results.
- Project-channel mapping and default suite behavior are configured by operators rather than explained through a friendly admin onboarding flow.

The current app description should also be tightened and proofread. Describe the outcome first—for example: “AI-assisted QA that explores your app, generates and runs Playwright tests, triages failures, and returns evidence-backed results.”

## Recommended Qali interaction model

### 1. Conversational intake

Support three first-class entry paths:

1. DM Qali for exploratory, multi-turn planning.
2. Mention `@Qali` in a mapped project channel for collaborative work.
3. Use a message shortcut such as **Test with Qali** or **Triage with Qali** on a bug report, release note, or customer complaint.

Qali should infer project and thread context when safe, then state the inference: “I’ll use `checkout-web`, staging, and the smoke suite.” If more than one project or environment is plausible, ask one focused question instead of showing an internal configuration form.

### 2. Plan and authorization preview

Before dispatch, show a compact plan only when it adds value:

> Explore checkout on staging for up to 10 minutes / 30 browser steps. Read project sources and existing observations. Write append-only observations and a report. Any test publication will require review.

For a routine authorized test run, Qali may proceed immediately. For visual baseline acceptance, governed-source edits, deletion or skipping of tests, autonomy changes, or publication outside the safe policy, require an explicit authorized confirmation.

### 3. Progressive thread status

Use one updatable status message rather than many noisy posts. Suggested phases are:

- Checking project and permission
- Preparing isolated workspace
- Starting target application
- Exploring or running Playwright
- Validating evidence and policy
- Preparing review change
- Reporting result

Show elapsed time and a **Stop** action when cancellation is supported. Do not expose implementation names such as harness step IDs unless the user expands diagnostics.

### 4. Stage-aware terminal card

The top of the result should answer five questions immediately:

1. What did Qali do?
2. Did the deterministic test or exploration succeed?
3. How many tests passed, failed, or were skipped?
4. Was evidence retained and was publication completed?
5. What should the user do next?

Example:

> **Exploration completed; review PR blocked**
>
> Checkout was explored in 6m 18s. 12 observations and 5 evidence items passed validation. The proposed append-only update is safe, but GitHub rejected the publication credential. No repository change was made.
>
> **Actions:** View report · Inspect evidence · Retry publication · Ask Qali to triage

This is more useful than describing the entire run as either green or red.

### 5. Persistent personal control surface

Build App Home, or Slack's agent split view where available, around:

- **Needs attention:** blocked publication, requested approval, failed test.
- **Running:** current phase, duration, project, environment, stop action.
- **Recent:** outcome, workflow, suite, evidence, PR/run links.
- **Projects:** channel mapping, default environment, default suite, last quality pulse.
- **Ask Qali:** dynamic prompts based on the selected project and recent failures.

The channel remains the place for team-visible outcomes; the personal surface becomes the place to browse history and manage work.

## Lessons from Linear's Slack experience

Linear's Slack integration is effective because it makes Slack context actionable without recreating the whole Linear product inside Slack. Its documented patterns include natural `@Linear` interactions, message actions, issue templates, channel-to-team configuration, rich unfurls with actions, and synchronized Slack/Linear conversations.

Qali can adapt those patterns:

- **Channel affinity:** map a channel to a project, default environment, and default suite. Always state the inferred mapping in the acknowledgement.
- **Act on a message:** let a customer report or developer note become a triage/exploration request without copying text into a new command.
- **Templates:** offer focused starters for release smoke, bug reproduction, exploratory charter, regression generation, and quality pulse.
- **Synced discussion:** when Qali opens a GitHub review PR or issue, link the Slack thread and external review thread so decisions remain traceable.
- **Rich, deduplicated unfurls:** show one useful run/report preview with status and actions; avoid repeating the same preview every time the link appears.
- **Notification discipline:** send personal attention items to the responsible user and team outcomes to the mapped channel, batching ambient quality updates.

Qali should not copy Linear's issue model literally. Its equivalent durable object is the evidence-backed QA run and its project knowledge, not an issue ticket.

## Prioritized roadmap

### P0 — trust and comprehension

1. Make terminal cards stage-aware: execution, evidence validation, publication, and notification. **Implemented (unit-tested; not live-verified).** Cards now show execution vs publication; kitchen copy such as “GitHub Actions failed before a test report was produced” is stripped.
2. Add richer progressive status with elapsed time and plain-language activity. **Implemented (unit-tested; not live-verified).** Work acks state inferred project, environment, and suite, then update one thread message.
3. Add source, environment, project, and evidence references to completion summaries.
4. Add confirmation previews for consequential governed changes. **Partial.** Generated tests default to keep + Retract; governed sources stay review-only.
5. Fix app profile and onboarding copy so the AI role and deterministic Playwright boundary are unmistakable. **Implemented (unit-tested; not live-verified).** Slack app description names Playwright and evidence-backed results. User guide states Qali is the E2E QA teammate.
6. Add App Home sections for needs-attention, running, and recent work. **Implemented (unit-tested; not live-verified).** Manifest enables the Home tab; `app_home_opened` publishes a personal control room. Re-upload the Slack manifest after merge.
7. Host HTML reports instead of asking people to unzip Markdown. **Live-verified.** Slack **Open report** on quality-pulse run [31752717647](https://github.com/hlemmur/qali/actions/runs/31752717647) served signed HTML (`200` `text/html`); unsigned and expired GETs returned `401`. GitHub remains the fallback. The pulse itself failed validation before the orchestrator ran.

### P1 — efficient daily use

1. Add **Test with Qali** and **Triage with Qali** message shortcuts. **Implemented (unit-tested; not live-verified).** Manifest includes both shortcuts and the `commands` bot scope. Re-upload the Slack app manifest, then use the message overflow menu. Triage requires a Qali run in the thread.
2. Add dynamic prompts based on project, channel, and recent run state.
3. Use DM for multi-turn planning and channel threads for concise shared progress.
4. Add project-channel affinity and an operator-friendly mapping flow.
5. Add result feedback and direct recovery actions.
6. Evaluate Slack's split-view agent container for Qali conversations.

### P2 — scale and polish

1. Add reusable QA request templates.
2. Batch scheduled quality-pulse notifications and suppress duplicate unfurls.
3. Add richer work-object previews for Qali reports and evidence bundles.
4. Synchronize Slack discussion with external review artifacts where useful.
5. Add an admin onboarding wizard and configuration health check.

## Success criteria

The improved experience is successful when a developer can:

- understand Qali's role and boundaries from the profile and first response;
- request meaningful QA without memorizing commands;
- see what Qali is doing without channel spam;
- tell execution failure from validation or publication failure at a glance;
- find the evidence and external review artifact in one click;
- safely approve or reject consequential changes;
- recover from a failure without asking an operator what to do next.

## Sources reviewed

- [Slack: Agents overview](https://docs.slack.dev/ai/agents/)
- [Slack: Agent design](https://docs.slack.dev/concepts/agent-design/)
- [Slack: Developing agents](https://docs.slack.dev/ai/developing-agents/)
- [Slack: Agent entry points and interaction](https://docs.slack.dev/ai/agent-entry-and-interaction/)
- [Slack: Agent governance](https://docs.slack.dev/ai/agent-governance/)
- [Slack: Agent context management](https://docs.slack.dev/ai/agent-context-management)
- [Slack: Split view](https://docs.slack.dev/surfaces/split-view/)
- [Linear: Slack integration](https://linear.app/docs/slack)

Slack's documentation is the authority for Slack platform behavior. The Linear section is product inspiration, and the prioritized roadmap is an inference tailored to Qali's architecture and current implementation.
