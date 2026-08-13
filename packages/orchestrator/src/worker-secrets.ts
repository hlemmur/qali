export const DEFAULT_CURSOR_MODEL = 'composer-2.5';

export const WORKER_SECRET_KEYS = {
  slack: ['SLACK_SIGNING_SECRET', 'SLACK_BOT_TOKEN', 'SLACK_BOT_USER_ID'] as const,
  github: [
    'GITHUB_WEBHOOK_SECRET',
    'QALI_CALLBACK_SECRET',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_INSTALLATION_ID',
    'GITHUB_OWNER',
    'GITHUB_REPO'
  ] as const
} as const;

export type WorkerSecretGroup = keyof typeof WORKER_SECRET_KEYS;
export type ActionsSyncGroup = 'actions' | 'cursor';
export type EnvSyncGroup = WorkerSecretGroup | ActionsSyncGroup;

export interface SecretValue {
  name: string;
  value: string;
}

export interface ActionsConfigToSync {
  repo: string;
  secrets: SecretValue[];
  variables: SecretValue[];
  skipped: string[];
}

export interface ProjectEnvironmentConfigToSync {
  environment: string;
  secrets: SecretValue[];
  variables: SecretValue[];
}

export function selectProjectEnvironmentConfigToSync(
  env: Record<string, string>,
  environment: string
): ProjectEnvironmentConfigToSync {
  if (!environment.trim()) throw new Error('GitHub Environment name is required');
  const requireValue = (name: string): SecretValue => {
    const value = env[name]?.trim() ?? '';
    if (!value) throw new Error(`Missing required project target value in .env: ${name}`);
    return { name, value };
  };
  return {
    environment,
    variables: [
      requireValue('QALI_TARGET_BASE_URL'),
      requireValue('QALI_ALLOWED_ORIGINS_JSON'),
      requireValue('QALI_TEST_DATA_JSON')
    ],
    secrets: [requireValue('QALI_TEST_CREDENTIALS_JSON')]
  };
}

export function selectPublicationEnvironmentConfigToSync(
  env: Record<string, string>
): ProjectEnvironmentConfigToSync {
  const token = env.QALI_PUBLISH_GITHUB_TOKEN?.trim() ?? '';
  return {
    environment: 'qali-publication',
    secrets: token ? [{ name: 'QALI_PUBLISH_GITHUB_TOKEN', value: token }] : [],
    variables: []
  };
}

export function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && !value.slice(1).includes(quote)) {
      const parts = [value.slice(1)];
      while (index + 1 < lines.length) {
        index += 1;
        const next = lines[index] ?? '';
        const end = next.indexOf(quote);
        if (end >= 0) {
          parts.push(next.slice(0, end));
          break;
        }
        parts.push(next);
      }
      value = parts.join('\n');
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function selectSecretsToSync(
  env: Record<string, string>,
  options: { only?: WorkerSecretGroup[] } = {}
): { secrets: SecretValue[]; skipped: string[] } {
  const groups = options.only ?? (Object.keys(WORKER_SECRET_KEYS) as WorkerSecretGroup[]);
  const names = groups.flatMap((group) => [...WORKER_SECRET_KEYS[group]]);
  const secrets: SecretValue[] = [];
  const skipped: string[] = [];

  for (const name of names) {
    const value = env[name]?.trim() ?? '';
    if (!value) {
      skipped.push(name);
      continue;
    }
    secrets.push({ name, value });
  }

  if (groups.includes('slack')) {
    for (const required of WORKER_SECRET_KEYS.slack) {
      if (!secrets.some((entry) => entry.name === required)) {
        throw new Error(`Missing required Slack secret in .env: ${required}`);
      }
    }
  }

  return { secrets, skipped };
}

function requireActionsRepo(env: Record<string, string>): string {
  const owner = env.GITHUB_OWNER?.trim() ?? '';
  const repo = env.GITHUB_REPO?.trim() ?? '';
  if (!owner || !repo) {
    throw new Error(
      'Missing GITHUB_OWNER / GITHUB_REPO in .env (required to sync GitHub Actions secrets/vars).'
    );
  }
  return `${owner}/${repo}`;
}

function pushMapped(
  list: SecretValue[],
  skipped: string[],
  env: Record<string, string>,
  envKey: string,
  actionsName: string,
  options: { defaultValue?: string; requireSource?: boolean } = {}
): void {
  const raw = env[envKey]?.trim() ?? '';
  const value = raw || options.defaultValue || '';
  if (!value) {
    skipped.push(actionsName === envKey ? envKey : `${envKey}→${actionsName}`);
    return;
  }
  if (options.requireSource && !raw) {
    skipped.push(actionsName === envKey ? envKey : `${envKey}→${actionsName}`);
    return;
  }
  list.push({ name: actionsName, value });
}

export function selectActionsConfigToSync(
  env: Record<string, string>,
  options: { only?: ActionsSyncGroup[] } = {}
): ActionsConfigToSync {
  const groups = options.only ?? (['actions'] as ActionsSyncGroup[]);
  const includeCursor = groups.includes('actions') || groups.includes('cursor');
  const includeAllActions = groups.includes('actions');
  const repo = requireActionsRepo(env);
  const secrets: SecretValue[] = [];
  const variables: SecretValue[] = [];
  const skipped: string[] = [];

  if (includeCursor) {
    pushMapped(secrets, skipped, env, 'CURSOR_API_KEY', 'CURSOR_API_KEY');
    const model = env.CURSOR_MODEL?.trim() ?? '';
    const apiKey = env.CURSOR_API_KEY?.trim() ?? '';
    if (model) {
      variables.push({ name: 'CURSOR_MODEL', value: model });
    } else if (apiKey) {
      variables.push({ name: 'CURSOR_MODEL', value: DEFAULT_CURSOR_MODEL });
    } else {
      skipped.push('CURSOR_MODEL');
    }
  }

  if (includeAllActions) {
    pushMapped(secrets, skipped, env, 'QALI_CALLBACK_SECRET', 'QALI_CALLBACK_SECRET');
    pushMapped(variables, skipped, env, 'WORKER_BASE_URL', 'QALI_WORKER_BASE_URL');
  }

  return { repo, secrets, variables, skipped };
}

export function parseEnvSyncGroups(raw?: string): {
  worker: WorkerSecretGroup[];
  actions: ActionsSyncGroup[];
} {
  if (!raw) {
    return { worker: ['slack', 'github'], actions: ['actions'] };
  }
  const requested = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const worker: WorkerSecretGroup[] = [];
  const actions: ActionsSyncGroup[] = [];
  for (const group of requested) {
    if (group === 'slack' || group === 'github') worker.push(group);
    else if (group === 'actions' || group === 'cursor') actions.push(group);
    else throw new Error(`Unknown sync group: ${group} (use slack, github, actions, cursor)`);
  }
  return { worker, actions };
}
