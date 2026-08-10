# Test Authoring Policy

Write deterministic tests only from approved test intent.

## Gate

Before creating or editing executable scenarios, require:

- an approved smoke proposal or approved scenario;
- a recorded decision for observation-sourced expected behavior;
- resolved execution blockers or an explicit override.

## Design

Cover the primary success path and material negative paths. Assert observable outcomes, not implementation details. Keep test data isolated and deterministic. Use web-first Playwright locators and assertions; never fixed sleeps.

Visual baselines, assertion changes, skips, deletions, and flake labels require human approval. A reproduced defect gets a regression test that is observed red before the fix and green after it.
