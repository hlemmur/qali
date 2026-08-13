/**
 * Sync local .env into Cloudflare Worker secrets and GitHub Actions secrets/vars.
 *
 * Usage:
 *   npm run control-plane:sync-secrets
 *   npm run control-plane:sync-secrets -- --only slack
 *   npm run control-plane:sync-secrets -- --only github
 *   npm run control-plane:sync-secrets -- --only actions
 *   npm run control-plane:sync-secrets -- --only cursor
 *   npm run control-plane:sync-secrets -- --only slack,cursor
 *   npm run control-plane:sync-secrets -- --only actions --project _demo
 *   npm run control-plane:sync-secrets -- --dry-run
 *
 * Groups:
 *   slack   → Worker Slack secrets
 *   github  → Worker GitHub App secrets
 *   actions → Actions secrets/vars (Cursor, callback, worker URL, publish token)
 *   cursor  → Actions CURSOR_API_KEY + CURSOR_MODEL only
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  parseDotEnv,
  parseEnvSyncGroups,
  selectActionsConfigToSync,
  selectPublicationEnvironmentConfigToSync,
  selectProjectEnvironmentConfigToSync,
  selectSecretsToSync
} from '../packages/orchestrator/src/worker-secrets.js';
import { ProjectRegistrySchema } from '../packages/contracts/src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.env.QALI_ENV_FILE
  ? join(repoRoot, process.env.QALI_ENV_FILE)
  : join(repoRoot, '.env');
const wranglerConfig = 'apps/slack-worker/wrangler.jsonc';
const dryRun = process.argv.includes('--dry-run');

const onlyIndex = process.argv.indexOf('--only');
const onlyArg = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
const groups = parseEnvSyncGroups(onlyArg);
const projectIndex = process.argv.indexOf('--project');
const projectArg = projectIndex >= 0 ? process.argv[projectIndex + 1]?.trim() : undefined;

if (!existsSync(envPath)) {
  throw new Error(`Missing env file: ${envPath}. Copy .env.example to .env and fill values.`);
}

const env = parseDotEnv(readFileSync(envPath, 'utf8'));
const registry = ProjectRegistrySchema.parse(
  JSON.parse(readFileSync(join(repoRoot, 'projects/registry.json'), 'utf8'))
);
const skipped: string[] = [];
let workerCount = 0;
let actionsCount = 0;

if (groups.worker.length > 0) {
  const { secrets, skipped: workerSkipped } = selectSecretsToSync(env, { only: groups.worker });
  skipped.push(...workerSkipped);
  if (secrets.length === 0 && groups.actions.length === 0) {
    throw new Error('No configured Worker secrets found to sync.');
  }
  console.log(
    dryRun
      ? `[dry-run] Would sync ${secrets.length} Worker secret(s) from ${envPath}`
      : `Syncing ${secrets.length} Worker secret(s) from ${envPath}`
  );
  for (const secret of secrets) {
    if (dryRun) {
      console.log(`[dry-run] wrangler secret put ${secret.name}`);
    } else {
      execFileSync('npx', ['wrangler', 'secret', 'put', secret.name, '--config', wranglerConfig], {
        cwd: repoRoot,
        input: secret.value,
        stdio: ['pipe', 'inherit', 'inherit'],
        encoding: 'utf8'
      });
      console.log(`Set Worker secret ${secret.name}`);
    }
    workerCount += 1;
  }
}

if (groups.actions.length > 0) {
  const actions = selectActionsConfigToSync(env, { only: groups.actions });
  skipped.push(...actions.skipped);
  const selectedProjects = projectArg
    ? registry.projects.filter((project) => project.id === projectArg)
    : registry.projects;
  if (projectArg && selectedProjects.length === 0) {
    throw new Error(`Unknown registered project: ${projectArg}`);
  }
  if (!projectArg && groups.actions.includes('actions') && selectedProjects.length > 1) {
    throw new Error(
      'Multiple projects are registered; pass --project <id> with a scoped env file.'
    );
  }
  const projectTargets = groups.actions.includes('actions')
    ? selectedProjects.map((project) =>
        selectProjectEnvironmentConfigToSync(env, project.githubEnvironment)
      )
    : [];
  const environmentTargets = groups.actions.includes('actions')
    ? [...projectTargets, selectPublicationEnvironmentConfigToSync(env)]
    : projectTargets;
  const total =
    actions.secrets.length +
    actions.variables.length +
    environmentTargets.reduce(
      (count, target) => count + target.secrets.length + target.variables.length,
      0
    );
  if (total === 0 && workerCount === 0) {
    throw new Error('No configured GitHub Actions secrets/vars found to sync.');
  }
  console.log(
    dryRun
      ? `[dry-run] Would sync ${total} Actions value(s) to ${actions.repo}`
      : `Syncing ${total} Actions value(s) to ${actions.repo}`
  );
  for (const secret of actions.secrets) {
    if (dryRun) {
      console.log(`[dry-run] gh secret set ${secret.name} --repo ${actions.repo}`);
    } else {
      execFileSync(
        'gh',
        ['secret', 'set', secret.name, '--repo', actions.repo, '--body', secret.value],
        {
          cwd: repoRoot,
          stdio: 'inherit',
          encoding: 'utf8'
        }
      );
      console.log(`Set Actions secret ${secret.name}`);
    }
    actionsCount += 1;
  }
  for (const variable of actions.variables) {
    if (dryRun) {
      console.log(`[dry-run] gh variable set ${variable.name} --repo ${actions.repo}`);
    } else {
      execFileSync(
        'gh',
        ['variable', 'set', variable.name, '--repo', actions.repo, '--body', variable.value],
        {
          cwd: repoRoot,
          stdio: 'inherit',
          encoding: 'utf8'
        }
      );
      console.log(`Set Actions variable ${variable.name}=${variable.value}`);
    }
    actionsCount += 1;
  }

  if (groups.actions.includes('actions')) {
    for (const target of environmentTargets) {
      for (const secret of target.secrets) {
        if (dryRun) {
          console.log(
            `[dry-run] gh secret set ${secret.name} --env ${target.environment} --repo ${actions.repo}`
          );
        } else {
          execFileSync(
            'gh',
            [
              'secret',
              'set',
              secret.name,
              '--env',
              target.environment,
              '--repo',
              actions.repo,
              '--body',
              secret.value
            ],
            { cwd: repoRoot, stdio: 'inherit', encoding: 'utf8' }
          );
          console.log(`Set ${target.environment} secret ${secret.name}`);
        }
        actionsCount += 1;
      }
      for (const variable of target.variables) {
        if (dryRun) {
          console.log(
            `[dry-run] gh variable set ${variable.name} --env ${target.environment} --repo ${actions.repo}`
          );
        } else {
          execFileSync(
            'gh',
            [
              'variable',
              'set',
              variable.name,
              '--env',
              target.environment,
              '--repo',
              actions.repo,
              '--body',
              variable.value
            ],
            { cwd: repoRoot, stdio: 'inherit', encoding: 'utf8' }
          );
          console.log(`Set ${target.environment} variable ${variable.name}`);
        }
        actionsCount += 1;
      }
    }
  }
}

if (workerCount + actionsCount === 0) {
  throw new Error('Nothing to sync (all selected keys were empty).');
}

if (skipped.length > 0) {
  console.log(`Skipped empty keys: ${[...new Set(skipped)].join(', ')}`);
}
