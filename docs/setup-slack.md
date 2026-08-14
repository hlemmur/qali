# Slack setup

Qali uses a standard Slack app with Events API and Interactions — works on **free Slack workspaces** for basic messaging. Dedicated Slack Agent surfaces may require a paid plan; Qali does not depend on them.

**Deploy the Cloudflare Worker first** so Slack can verify request URLs. See [setup-cloudflare.md](setup-cloudflare.md).

## 1. Create a Slack app from manifest

The committed template [`apps/slack-worker/slack-app-manifest.json`](../apps/slack-worker/slack-app-manifest.json) stays **environment-generic** (placeholder `*.example.workers.dev` URLs). Render a local copy from `.env` before uploading to Slack.

1. Provision and deploy Cloudflare ([setup-cloudflare.md](setup-cloudflare.md)).
2. Set in `.env` (see `.env.example`):

```bash
WORKER_BASE_URL=https://qali-slack-control.<your-subdomain>.workers.dev
```

3. Render the env-resolved manifest (does not modify the generic template):

```bash
npm run control-plane:render-slack-manifest
# writes apps/slack-worker/slack-app-manifest.local.json (gitignored)
```

4. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
5. Paste / upload `apps/slack-worker/slack-app-manifest.local.json`.
6. **Install to workspace**.
7. Set the app icon (Slack manifests cannot include images). In **Basic Information → Display Information**, upload [`apps/slack-worker/assets/qali-icon.png`](../apps/slack-worker/assets/qali-icon.png) (1024×1024). Optionally set via [`apps.icon.set`](https://docs.slack.dev/reference/methods/apps.icon.set) with a public image URL or multipart upload.
8. Copy credentials into the repo `.env` (from `.env.example`):

| Slack UI                                                        | Env / secret           |
| --------------------------------------------------------------- | ---------------------- |
| Bot User OAuth Token                                            | `SLACK_BOT_TOKEN`      |
| Signing Secret                                                  | `SLACK_SIGNING_SECRET` |
| Bot User ID (Basic Information → App Credentials / bot profile) | `SLACK_BOT_USER_ID`    |

9. Push those values to the Cloudflare Worker:

```bash
# Sync only Slack secrets from .env (skips empty GitHub keys)
npm run control-plane:sync-secrets -- --only slack

# Or sync every non-empty Worker + Actions value defined in .env
# (includes CURSOR_API_KEY / CURSOR_MODEL → GitHub Actions)
npm run control-plane:sync-secrets
```

Secrets are read from `.env` by default (`QALI_ENV_FILE` overrides the path). Values are never printed; Wrangler receives them on stdin.

Redeploy if the Worker was already live without these secrets:

```bash
npm run control-plane:deploy
```

### What the manifest configures

| Setting           | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Background color  | `#ff0084`                                                   |
| App icon          | Upload separately — see step 7 (`assets/qali-icon.png`)     |
| Bot events        | `app_mention`, `message.im`                                 |
| Events URL        | `{WORKER}/slack/events`                                     |
| Interactivity URL | `{WORKER}/slack/interactions`                               |
| Bot scopes        | `app_mentions:read`, `chat:write`, `im:history`, `im:write` |
| Socket Mode       | Off (HTTP webhooks)                                         |

## 2. Configure allowlists and roles

| Variable                    | Purpose                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `SLACK_ALLOWED_USER_IDS`    | Comma-separated Slack user IDs allowed to talk to Qali. Empty = no user filter.                                     |
| `SLACK_ALLOWED_TEAM_IDS`    | Restrict to workspace(s).                                                                                           |
| `SLACK_ALLOWED_CHANNEL_IDS` | Restrict to product channel(s) for mentions.                                                                        |
| `SLACK_OPS_CHANNEL_IDS`     | CSV of ops channel IDs (create `#qali-ops` and paste its ID). Maintenance is allowed only here.                     |
| `SLACK_QA_LEAD_USER_IDS`    | Break-glass user IDs who may request maintenance **in an ops channel**. They remain Developers in product channels. |

### Role behavior

- **Developer** (product channels) — onboard from an https URL, exploration, generate/run suites, triage, quality pulse, query. Cannot change autonomy, policy, authority, or trigger maintenance.
- **Ops** (`#qali-ops`) — `maintain-knowledge`, `maintain-suite`, and `maintain-schedule` (pause/resume/cron edits) for break-glass users listed in `SLACK_QA_LEAD_USER_IDS`.

Authorization runs in the Worker queue handler **before** GitHub dispatch.

## 3. Smoke-check from Slack

1. Invite `@Qali` to a channel (or open a DM).
2. Mention: `@Qali run the dashboard suite` (or DM the same text).
3. Expect acknowledgement, then a compact summary after GitHub Actions finishes (requires [setup-github.md](setup-github.md)).

Without GitHub wiring, the Worker still accepts and queues work; dispatch will fail until GitHub App secrets are set.

## 4. Compact Slack UX

Qali posts:

1. **Acknowledgement** — inferred project/environment/suite plus a plain-language phase for work, or a direct answer for quality questions. App Home lists needs-attention, running, and recent work.
2. **Summary** — pass/fail counts, duration, and an environment label (Mock Mode badge only when the execution profile is mock)
3. **Actions** — **Open report**, GitHub, Expand, Rerun, Triage (role-gated)

Hosted HTML reports are the human-facing recap. Markdown and JSON stay in Git as machine-readable truth. Artifact zips remain a fallback.

## Troubleshooting

| Symptom                          | Check                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Manifest URL verification failed | Worker deployed? Correct `WORKER_BASE_URL`? See [setup-cloudflare.md](setup-cloudflare.md)              |
| 403 Forbidden                    | User not in `SLACK_ALLOWED_USER_IDS`                                                                    |
| Request ignored                  | Bot messages filtered; verify `SLACK_BOT_USER_ID`                                                       |
| No GitHub run                    | Worker logs, `GITHUB_APP_ID`, installation, workflow file name                                          |
| Signature failures               | Clock skew; verify `SLACK_SIGNING_SECRET`                                                               |
| Maintenance rejected             | Ask in `#qali-ops`; add the user to `SLACK_QA_LEAD_USER_IDS` and the channel to `SLACK_OPS_CHANNEL_IDS` |

## Cost and retention

- **Cloudflare Workers** — free tier covers moderate Slack traffic; Queues and D1 have separate limits. Details in [setup-cloudflare.md](setup-cloudflare.md).
- **Workers AI** — intent classification; monitor usage on free tier.
- **D1** — correlation records; prune old rows periodically (retention policy: 90 days recommended, not automated in MVP).
