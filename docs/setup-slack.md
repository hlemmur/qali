# Slack setup

Qali uses a standard Slack app with Events API and Interactions — works on **free Slack workspaces** for basic messaging. Dedicated Slack Agent surfaces may require a paid plan; Qali does not depend on them.

**Deploy the Cloudflare Worker first** so Slack can verify request URLs. See [setup-cloudflare.md](setup-cloudflare.md).

## 1. Create a Slack app from manifest

Qali ships a Slack App Manifest at `apps/slack-worker/slack-app-manifest.json`.

1. Provision and deploy Cloudflare ([setup-cloudflare.md](setup-cloudflare.md)).
2. Render URLs for your Worker:

```bash
WORKER_BASE_URL=https://qali-slack-control.<your-subdomain>.workers.dev \
  npm run control-plane:render-slack-manifest
```

3. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
4. Paste the contents of `apps/slack-worker/slack-app-manifest.json` (or upload the file).
5. Review scopes and URLs, then create.
6. **Install to workspace**.
7. Copy credentials into Worker secrets:

| Slack UI                                                                                   | Env / secret           |
| ------------------------------------------------------------------------------------------ | ---------------------- |
| Bot User OAuth Token                                                                       | `SLACK_BOT_TOKEN`      |
| Signing Secret                                                                             | `SLACK_SIGNING_SECRET` |
| Bot User ID (under App Home / Basic Information → App ID section, or from `@Qali` profile) | `SLACK_BOT_USER_ID`    |

```bash
npx wrangler secret put SLACK_SIGNING_SECRET --config apps/slack-worker/wrangler.jsonc
npx wrangler secret put SLACK_BOT_TOKEN --config apps/slack-worker/wrangler.jsonc
npx wrangler secret put SLACK_BOT_USER_ID --config apps/slack-worker/wrangler.jsonc
```

Redeploy if the Worker was already live without these secrets:

```bash
npm run control-plane:deploy
```

### What the manifest configures

| Setting           | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
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

| Symptom                           | Check                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Manifesto URL verification failed | Worker deployed? Correct `WORKER_BASE_URL`? See [setup-cloudflare.md](setup-cloudflare.md) |
| 403 Forbidden                     | User not in `SLACK_ALLOWED_USER_IDS`                                                       |
| Request ignored                   | Bot messages filtered; verify `SLACK_BOT_USER_ID`                                          |
| No GitHub run                     | Worker logs, `GITHUB_APP_ID`, installation, workflow file name                             |
| Signature failures                | Clock skew; verify `SLACK_SIGNING_SECRET`                                                  |
| Maintenance rejected              | User is Developer, not QA Lead — add to `SLACK_QA_LEAD_USER_IDS`                           |

## Cost and retention

- **Cloudflare Workers** — free tier covers moderate Slack traffic; Queues and D1 have separate limits. Details in [setup-cloudflare.md](setup-cloudflare.md).
- **Workers AI** — intent classification; monitor usage on free tier.
- **D1** — correlation records; prune old rows periodically (retention policy: 90 days recommended, not automated in MVP).
