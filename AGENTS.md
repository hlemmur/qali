# AGENTS.md

## Cursor Cloud specific instructions

Qali is a Slack-first autonomous QA orchestrator. It is an **npm workspaces monorepo** (Node 22; CI pins `22.18.0`) with one deployable app (`apps/slack-worker`, a Cloudflare Worker control plane) and internal `packages/*`. Playwright is the deterministic execution engine; the full live product path (Slack → Cloudflare Worker + D1/Queue/AI/R2 → GitHub Actions) needs external credentials, but the whole loop is runnable **credential-free in Mock Mode** locally.

Standard commands are documented in `README.md` and `docs/developer-guide.md` (§12 "Local gate") and defined in root `package.json` scripts. Prefer those. Notes below are the non-obvious caveats discovered during setup.

### Services / how to run

- **Full gate (lint/format/build/validators/tests):** `npm run check`. This runs `prettier --check`, `eslint`, `tsc --noEmit`, project/qualification registry validators, and Vitest (`vitest run`, ~442 tests). Several unit tests create throwaway git repos, so benign `hint: Using 'master' as the name for the initial branch` lines in the output are expected, not failures.
- **Playwright E2E (mock target):** `npm run demo:test`. This one **auto-starts** the `_demo` target server via Playwright's `webServer` (it sets `QALI_WEB_SERVER_COMMAND`/`QALI_WEB_SERVER_URL`), so no manual server start is needed. If it errors with `... :4173/health is already used`, a stray demo server is still bound to port 4173 — free that port first.
- **Full Mock Mode orchestrator loop (the credential-free end-to-end "product" run):** `npm run demo:loop`. **Gotcha:** unlike `demo:test`, this does *not* start the target web server. You must start it yourself first, otherwise every test fails with `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/` and `run-test-suite` reports failed:

  ```bash
  node projects/_demo/app/server.mjs &   # serves 127.0.0.1:4173, /health -> {"ok":true,"mode":"mock"}
  QALI_TARGET_BASE_URL=http://127.0.0.1:4173 npm run demo:loop
  ```

  A healthy run prints `Explore … / Generate … / Run … : succeeded` and `7 passed, 0 failed`.
- **Cloudflare Worker (control plane):** `npm run control-plane:dry-run` bundles and validates the Worker (bindings for `qali-inbound` Queue, `qali-control` D1, `qali-reports` R2, `AI`) with **no** credentials — use this to verify Worker changes. `control-plane:dev`/`:deploy` and `control-plane:sync-secrets` require `wrangler login` + provisioned Cloudflare/Slack/GitHub secrets and are not runnable in a fresh VM.

### Caveats

- `demo:test` and `demo:loop` **regenerate** files under `projects/_demo/` (e.g. `derived/scenarios/coverage-map.md` and `tests/generated/dashboard.generated.spec.ts`). Revert these before committing unrelated work: `git checkout -- projects/_demo/derived/scenarios/coverage-map.md && rm -f projects/_demo/tests/generated/dashboard.generated.spec.ts`.
- Loopback binding works in this VM, so the `listen EPERM 127.0.0.1` sandbox warning mentioned in the docs does not apply here.
- Playwright browsers are not part of `npm ci`; the Chromium build is installed separately (already handled by the environment update script).
- `projects/_demo` is a Vitest/demo fixture only — it is **not** the Slack product path. The live target (`projects/sauce-demo`) uses a production profile with no Mock Mode badge and requires a qualified Cursor identity for agent steps.
