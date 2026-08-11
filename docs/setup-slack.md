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

# Or sync every non-empty Worker secret defined in .env
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

| Variable                    | Purpose                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `SLACK_ALLOWED_USER_IDS`    | Comma-separated Slack user IDs allowed to talk to Qali. Empty = no user filter.                                                     |
| `SLACK_ALLOWED_TEAM_IDS`    | Restrict to workspace(s).                                                                                                           |
| `SLACK_ALLOWED_CHANNEL_IDS` | Restrict to channel(s) for mentions.                                                                                                |
| `SLACK_QA_LEAD_USER_IDS`    | Users mapped to **QA Lead/Admin** — can trigger maintenance and policy workflows. All other allowed users default to **Developer**. |

### Role behavior

- **Developer** — exploration, generate/run suites, triage, quality pulse. Cannot change autonomy, policy, authority, or trigger maintenance workflows.
- **QA Lead/Admin** — full workflow access including `maintain-knowledge`, `maintain-suite`, and governance parameters.

Authorization runs in the Worker queue handler **before** GitHub dispatch.

## 3. Smoke-check from Slack

1. Invite `@Qali` to a channel (or open a DM).
2. Mention: `@Qali run the dashboard suite` (or DM the same text).
3. Expect acknowledgement, then a compact summary after GitHub Actions finishes (requires [setup-github.md](setup-github.md)).

Without GitHub wiring, the Worker still accepts and queues work; dispatch will fail until GitHub App secrets are set.

## 4. Compact Slack UX

Qali posts:

1. **Acknowledgement** — “Working on it…” with request id
2. **Summary** — pass/fail counts, duration, `[MOCK MODE]` badge when applicable
3. **Actions** — “Show details”, “Rerun”, “Triage failure” (role-gated)

Full Markdown reports live in GitHub artifacts and `projects/<id>/derived/reports/`.

## Troubleshooting

| Symptom                          | Check                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Manifest URL verification failed | Worker deployed? Correct `WORKER_BASE_URL`? See [setup-cloudflare.md](setup-cloudflare.md) |
| 403 Forbidden                    | User not in `SLACK_ALLOWED_USER_IDS`                                                       |
| Request ignored                  | Bot messages filtered; verify `SLACK_BOT_USER_ID`                                          |
| No GitHub run                    | Worker logs, `GITHUB_APP_ID`, installation, workflow file name                             |
| Signature failures               | Clock skew; verify `SLACK_SIGNING_SECRET`                                                  |
| Maintenance rejected             | User is Developer, not QA Lead — add to `SLACK_QA_LEAD_USER_IDS`                           |

## Cost and retention

- **Cloudflare Workers** — free tier covers moderate Slack traffic; Queues and D1 have separate limits. Details in [setup-cloudflare.md](setup-cloudflare.md).
- **Workers AI** — intent classification; monitor usage on free tier.
- **D1** — correlation records; prune old rows periodically (retention policy: 90 days recommended, not automated in MVP).
