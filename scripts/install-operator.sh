#!/usr/bin/env bash
# Operator install for Qali. Developers never copy projects/_template —
# Slack `@Qali onboard https://…` scaffolds the pack, upserts projects/registry.json,
# and the Worker provisions the GitHub Environment.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Qali operator install"
echo "Do not copy projects/_template. Product onboarding is Slack-only."
echo

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/install-operator.sh

1. Copies .env.example → .env when missing (you fill secrets).
2. Renders the Slack app manifest.
3. Dry-runs the Cloudflare Worker deploy.
4. Prints the remaining operator steps (wrangler login, secret sync, live deploy).

Developers: mention @Qali onboard <https URL> in the product channel.
EOF
  exit 0
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Wrote .env from .env.example — fill secrets before a live deploy."
fi

npm run control-plane:render-slack-manifest
npm run control-plane:dry-run

cat <<'EOF'

Next (operators only):
  npx wrangler login
  npm run control-plane:provision
  npm run control-plane:sync-secrets
  npm run control-plane:deploy
  Re-upload apps/slack-worker/slack-app-manifest.local.json in Slack.

Then invite Qali to the product channel and #qali-ops. First project:
  @Qali onboard https://www.saucedemo.com
EOF
