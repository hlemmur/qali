# Slack setup

Qali uses a standard Slack app with Events API and Interactions — works on **free Slack workspaces** for basic messaging. Dedicated Slack Agent surfaces may require a paid plan; Qali does not depend on them.

## 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch.
2. Enable **Event Subscriptions** → Request URL: `https://<your-worker>.workers.dev/slack/events`
3. Subscribe to bot events: `app_mention`, `message.im`
4. Enable **Interactivity** → Request URL: `https://<your-worker>.workers.dev/slack/interactions`
5. **OAuth & Permissions** → Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
   - `im:write`
6. Install to workspace and copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
7. Copy **Signing Secret** → `SLACK_SIGNING_SECRET`
8. Copy the bot user ID → `SLACK_BOT_USER_ID`

## 2. Configure allowlists and roles

Copy `.env.example` to your Worker secrets (Wrangler or Cloudflare dashboard):

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

## 3. Deploy the Worker

```bash
cd apps/slack-worker
npx wrangler d1 migrations apply qali-control --remote
npx wrangler secret put SLACK_SIGNING_SECRET
# ... repeat for all secrets from .env.example
npx wrangler deploy
```

Verify with `npx wrangler deploy --dry-run` locally (no credentials needed).

## 4. Compact Slack UX

Qali posts:

1. **Acknowledgement** — “Working on it…” with request id
2. **Summary** — pass/fail counts, duration, `[MOCK MODE]` badge when applicable
3. **Actions** — “Show details”, “Rerun”, “Triage failure” (role-gated)

Full Markdown reports live in GitHub artifacts and `projects/<id>/derived/reports/`.

## Troubleshooting

| Symptom              | Check                                                            |
| -------------------- | ---------------------------------------------------------------- |
| 403 Forbidden        | User not in `SLACK_ALLOWED_USER_IDS`                             |
| Request ignored      | Bot messages filtered; verify `SLACK_BOT_USER_ID`                |
| No GitHub run        | Worker logs, `GITHUB_APP_ID`, installation, workflow file name   |
| Signature failures   | Clock skew; verify `SLACK_SIGNING_SECRET`                        |
| Maintenance rejected | User is Developer, not QA Lead — add to `SLACK_QA_LEAD_USER_IDS` |

## Cost and retention

- **Cloudflare Workers** — free tier covers moderate Slack traffic; Queues and D1 have separate limits.
- **Workers AI** — intent classification; monitor usage on free tier.
- **D1** — correlation records; prune old rows periodically (retention policy: 90 days recommended, not automated in MVP).
