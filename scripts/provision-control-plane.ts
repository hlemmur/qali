/**
 * Provision Cloudflare control-plane resources and render the Slack app manifest.
 *
 * Usage:
 *   npm run control-plane:provision [-- --dry-run]
 *   WORKER_BASE_URL=https://... npm run control-plane:render-slack-manifest
 *
 * Requires: wrangler authenticated (`npx wrangler login`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_PLANE_DEFAULTS,
  parseD1CreateOutput,
  patchWranglerDatabaseId,
  renderSlackAppManifest,
  resolveWorkerBaseUrl
} from '../packages/orchestrator/src/control-plane-setup.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = join(repoRoot, 'apps/slack-worker');
const wranglerPath = join(workerDir, 'wrangler.jsonc');
const manifestPath = join(workerDir, 'slack-app-manifest.json');
const dryRun = process.argv.includes('--dry-run');
const renderOnly =
  process.argv.includes('--render-slack-manifest') ||
  process.env.QALI_RENDER_SLACK_MANIFEST === '1';

function run(command: string, args: string[], cwd = workerDir): string {
  if (dryRun) {
    console.log(`[dry-run] ${command} ${args.join(' ')}`);
    return '';
  }
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function currentDatabaseId(configText: string): string | undefined {
  const match = configText.match(/"database_id"\s*:\s*"([^"]+)"/);
  const value = match?.[1];
  if (!value || value === CONTROL_PLANE_DEFAULTS.placeholderDatabaseId) return undefined;
  return value;
}

function ensureD1(): string {
  const configText = readFileSync(wranglerPath, 'utf8');
  const existing = currentDatabaseId(configText);
  if (existing) {
    console.log(`D1 database already configured: ${existing}`);
    return existing;
  }

  console.log(`Creating D1 database ${CONTROL_PLANE_DEFAULTS.d1DatabaseName}...`);
  if (dryRun) {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    console.log(`[dry-run] would write database_id=${fakeId} into wrangler.jsonc`);
    return fakeId;
  }

  let output: string;
  try {
    output = run('npx', ['wrangler', 'd1', 'create', CONTROL_PLANE_DEFAULTS.d1DatabaseName]);
  } catch (error) {
    output =
      error instanceof Error && 'stdout' in error
        ? String((error as { stdout?: string }).stdout ?? '')
        : '';
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message) && !parseD1CreateOutput(output)) {
      throw error;
    }
  }

  const databaseId = parseD1CreateOutput(output);
  if (!databaseId) {
    throw new Error(
      `Could not parse D1 database id from wrangler output. Paste it into ${wranglerPath} manually.\n${output}`
    );
  }
  writeFileSync(
    wranglerPath,
    patchWranglerDatabaseId(readFileSync(wranglerPath, 'utf8'), databaseId)
  );
  console.log(`Wrote database_id=${databaseId} to wrangler.jsonc`);
  return databaseId;
}

function ensureQueue(): void {
  console.log(`Creating queue ${CONTROL_PLANE_DEFAULTS.queueName} (no-op if it already exists)...`);
  try {
    run('npx', ['wrangler', 'queues', 'create', CONTROL_PLANE_DEFAULTS.queueName]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) {
      const stderr =
        error instanceof Error && 'stderr' in error
          ? String((error as { stderr?: string }).stderr ?? '')
          : '';
      if (!/already exists/i.test(stderr)) throw error;
    }
    console.log('Queue already exists.');
  }
}

function applyMigrations(): void {
  console.log('Applying D1 migrations remotely...');
  run('npx', [
    'wrangler',
    'd1',
    'migrations',
    'apply',
    CONTROL_PLANE_DEFAULTS.d1DatabaseName,
    '--remote'
  ]);
}

function writeSlackManifest(baseUrl: string): void {
  const manifest = renderSlackAppManifest(baseUrl);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote Slack app manifest: ${manifestPath}`);
  console.log(`  events:        ${manifest.settings.event_subscriptions.request_url}`);
  console.log(`  interactions:  ${manifest.settings.interactivity.request_url}`);
  console.log(`  github webhook:${baseUrl}/github/webhook`);
}

function printSecretChecklist(): void {
  console.log(`
Next: set Worker secrets from the repo root / apps/slack-worker:

  npx wrangler secret put SLACK_SIGNING_SECRET --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put SLACK_BOT_TOKEN --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put SLACK_BOT_USER_ID --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put GITHUB_WEBHOOK_SECRET --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put GITHUB_APP_ID --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put GITHUB_APP_PRIVATE_KEY --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put GITHUB_INSTALLATION_ID --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put GITHUB_OWNER --config apps/slack-worker/wrangler.jsonc
  npx wrangler secret put GITHUB_REPO --config apps/slack-worker/wrangler.jsonc

Optional allowlists / roles (or set as wrangler vars):
  SLACK_ALLOWED_TEAM_IDS, SLACK_ALLOWED_CHANNEL_IDS, SLACK_ALLOWED_USER_IDS, SLACK_QA_LEAD_USER_IDS

Then deploy:
  npm run control-plane:deploy
`);
}

if (!existsSync(wranglerPath)) {
  throw new Error(`Missing ${wranglerPath}`);
}

if (renderOnly) {
  const baseUrl = resolveWorkerBaseUrl({
    ...(process.env.WORKER_BASE_URL ? { override: process.env.WORKER_BASE_URL } : {}),
    ...(process.env.CLOUDFLARE_WORKERS_SUBDOMAIN
      ? { workersSubdomain: process.env.CLOUDFLARE_WORKERS_SUBDOMAIN }
      : {})
  });
  writeSlackManifest(baseUrl);
  process.exit(0);
}

console.log(
  dryRun
    ? '[dry-run] Provisioning Cloudflare control plane (no remote mutations except local files when noted)'
    : 'Provisioning Cloudflare control plane...'
);

ensureD1();
ensureQueue();
if (!dryRun) applyMigrations();
else console.log('[dry-run] skip remote migrations');

const baseUrl = process.env.WORKER_BASE_URL
  ? resolveWorkerBaseUrl({ override: process.env.WORKER_BASE_URL })
  : process.env.CLOUDFLARE_WORKERS_SUBDOMAIN
    ? resolveWorkerBaseUrl({
        workersSubdomain: process.env.CLOUDFLARE_WORKERS_SUBDOMAIN
      })
    : `https://${CONTROL_PLANE_DEFAULTS.workerName}.<your-subdomain>.workers.dev`;

if (baseUrl.includes('<your-subdomain>')) {
  writeFileSync(
    manifestPath,
    `${JSON.stringify(renderSlackAppManifest('https://qali-slack-control.example.workers.dev'), null, 2)}\n`
  );
  console.log(
    `Wrote placeholder Slack manifest at ${manifestPath}. Re-run with WORKER_BASE_URL after deploy.`
  );
} else {
  writeSlackManifest(baseUrl);
}

printSecretChecklist();
