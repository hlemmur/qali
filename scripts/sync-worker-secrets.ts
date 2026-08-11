/**
 * Push configured Worker secrets from a local .env file via Wrangler.
 *
 * Usage:
 *   npm run control-plane:sync-secrets
 *   npm run control-plane:sync-secrets -- --only slack
 *   npm run control-plane:sync-secrets -- --only github
 *   npm run control-plane:sync-secrets -- --dry-run
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  parseDotEnv,
  selectSecretsToSync,
  type WorkerSecretGroup
} from '../packages/orchestrator/src/worker-secrets.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.env.QALI_ENV_FILE
  ? join(repoRoot, process.env.QALI_ENV_FILE)
  : join(repoRoot, '.env');
const wranglerConfig = 'apps/slack-worker/wrangler.jsonc';
const dryRun = process.argv.includes('--dry-run');

const onlyIndex = process.argv.indexOf('--only');
const onlyArg = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
const only = onlyArg
  ? (onlyArg.split(',').map((entry) => entry.trim()) as WorkerSecretGroup[])
  : undefined;

if (!existsSync(envPath)) {
  throw new Error(`Missing env file: ${envPath}. Copy .env.example to .env and fill values.`);
}

const env = parseDotEnv(readFileSync(envPath, 'utf8'));
const { secrets, skipped } = selectSecretsToSync(env, only ? { only } : {});

if (secrets.length === 0) {
  throw new Error('No configured Worker secrets found to sync.');
}

console.log(
  dryRun
    ? `[dry-run] Would sync ${secrets.length} secret(s) from ${envPath}`
    : `Syncing ${secrets.length} secret(s) from ${envPath}`
);

for (const secret of secrets) {
  if (dryRun) {
    console.log(`[dry-run] wrangler secret put ${secret.name}`);
    continue;
  }
  execFileSync('npx', ['wrangler', 'secret', 'put', secret.name, '--config', wranglerConfig], {
    cwd: repoRoot,
    input: secret.value,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8'
  });
  console.log(`Set ${secret.name}`);
}

if (skipped.length > 0) {
  console.log(`Skipped empty keys: ${skipped.join(', ')}`);
}
