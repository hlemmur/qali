# Qali Private-MVP Release Readiness

Last reviewed: 2026-09-10

Current decision: **NO-GO**

This is the auditable release gate for the owner-only Qali private MVP. A checked item
requires linked or recorded evidence; intention, local implementation, and mock success
do not satisfy a live gate. Never paste credentials, tokens, signed URLs, or target
secrets into this file.

## Decision authority

- The Qali owner is the sole go/no-go and rollback approver.
- **Explicit owner approval** is required before creating or changing cloud resources,
  deploying, running live Gemini evaluations, or using Slack/SauceDemo integrations.
- A failed mandatory gate keeps the decision at NO-GO. There is no paid-model fallback.

## Release candidate identity

- [ ] Record the exact Git commit SHA.
- [ ] Record the container image digest and scan report.
- [ ] Record the pinned Gemini model ID, workflow version, runtime-skill hashes, and
      Playwright MCP version from a produced runtime manifest.
- [ ] Confirm the release branch contains no target-specific SauceDemo/cart logic
      outside fixtures and qualification data.

## Offline evidence

- [x] Unit, integration, and contract suites pass without live credentials.
- [x] Ruff, formatting, codespell, and ty checks pass.
- [x] Default model traffic is free-tier-only, bounded by output tokens, retry status,
      invocation time, request count, and process concurrency.
- [x] Deterministic doubles cover onboarding, two unrelated feature workflows,
      browser policy/oracles, failure classification, durable artifacts, Slack
      projection, retries, and restart-safe persistence boundaries.
- [ ] Record the final candidate command output and GitHub check URLs after all
      implementation PRs merge.

## Live qualification gates

- [ ] With synthetic, public, or explicitly non-sensitive data only, two consecutive
      core eval runs score at least 90% with no critical grounding or safety failure.
- [ ] The untouched held-out eval scores at least 85% with no critical grounding or
      safety failure.
- [ ] A scanned release container passes the real Playwright MCP contract and starts
      with localhost-only, headless, isolated browser configuration.
- [ ] The approved environment produces two clean isolated SauceDemo cart runs.
- [ ] The approved environment produces one intentionally failing oracle path with a
      stable finding ID and complete redacted evidence.
- [ ] Slack onboarding, feature test, and finding follow-up complete in the private
      project channel with same-thread progress and no secret exposure.
- [ ] Firestore/GCS evidence survives a worker restart and remains project-isolated.
- [ ] Cloud Trace contains correlated coordinator, specialist, model, and tool spans;
      Cloud Logging contains correlation metadata without prompt, source, credential,
      or browser-secret content.

## Deployment gate

- [x] The generated Cloud Run/Terraform service baseline has been reviewed for the
      approved project and region without applying it; it defines separate Slack
      ingress and unified private worker services but is not the complete Qali topology.
- [x] The reviewed Terraform defines a rate-limited Cloud Tasks queue, bounded retries,
      task-level OIDC, queue-scoped enqueue permission, and a dedicated identity that
      can invoke only the private unified worker. This is offline configuration
      evidence, not a successful plan, apply, or live dispatch.
- [x] The reviewed Terraform defines the protected Standard `(default)` Firestore
      database, project-level data-user access for only the ingress and worker runtime
      identities, and their existing collection/lease contract. Existing databases
      must be imported; this is not live persistence evidence.
- [ ] Secret-level access, GCS artifact IAM, lifecycle retention, ingress invocation
      policy, and budget controls are verified in the complete reviewed plan.
- [ ] The owner confirms the deploy window, 100 SEK alert boundary, integration test
      data, rollback operator, and previous known-good revision.
- [ ] **Explicit owner approval** is recorded immediately before resource changes and
      deployment.

## Rollback triggers

Rollback begins without further debate when any of these occurs during qualification
or the first two hours after promotion:

- Three consecutive health-check failures.
- Any secret, credential value, signed URL, or confidential source appears in a prompt,
  trace, log, Slack message, or stored derived artifact.
- Any forbidden browser origin/action succeeds, or a harness-owned failed oracle is
  reported as passed.
- Error rate exceeds twice the measured qualification baseline for five minutes, or
  P95 worker latency exceeds three times baseline for five minutes.
- Queue backlog grows for ten minutes while worker throughput is zero.
- Paid Vertex AI/model traffic is observed, free quota exhaustion does not fail closed,
  or runtime identity differs from the approved manifest.
- Durable job/artifact identity, restart recovery, or project isolation fails.

## Rollback procedure

1. Stop new work by pausing the Qali Cloud Tasks queue and disable Slack event delivery
   to the affected ingress if requests continue to arrive.
2. Route Cloud Run traffic to the recorded previous known-good immutable revision. Do
   not rebuild or retag an image during rollback.
3. Cancel or terminally classify active test jobs without deleting their redacted
   evidence; do not replay consequential browser actions.
4. Run the health and read-only smoke checks below. If data integrity or secret exposure
   is suspected, keep processing disabled and rotate affected credentials through the
   approved secret-management process.
5. Record trigger time, operator, affected run IDs, restored revision, verification
   evidence, and follow-up owner in the release log.

## Post-deployment verification

Run immediately after zero-traffic deployment, again after owner-only promotion, and
again after 15 minutes:

- [ ] Ingress and worker health endpoints return HTTP 200 within the recorded baseline.
- [ ] A duplicate signed Slack fixture is acknowledged once and creates one durable job.
- [ ] One approved read-only onboarding/knowledge lookup survives worker restart.
- [ ] One isolated SauceDemo smoke scenario produces deterministic scenario/check
      counts and complete redacted artifacts.
- [ ] A known finding follow-up reads stored evidence without rerunning the browser.
- [ ] Queue depth drains, no new exception class appears, and P50/P95 latency remains
      within the rollback thresholds.
- [ ] Trace/log/artifact correlation succeeds for the same run ID with no secret leak.

## Sign-off

- Decision: NO-GO
- Owner: pending
- Timestamp: pending
- Candidate commit/image: pending
- Evidence links: pending
- Reason: live evaluation, infrastructure review/deployment, real integration, restart,
  observability, rollback, and post-deployment gates have not yet been executed.
