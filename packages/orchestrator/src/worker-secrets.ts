export const WORKER_SECRET_KEYS = {
  slack: ['SLACK_SIGNING_SECRET', 'SLACK_BOT_TOKEN', 'SLACK_BOT_USER_ID'] as const,
  github: [
    'GITHUB_WEBHOOK_SECRET',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_INSTALLATION_ID',
    'GITHUB_OWNER',
    'GITHUB_REPO'
  ] as const
} as const;

export type WorkerSecretGroup = keyof typeof WORKER_SECRET_KEYS;

export interface SecretValue {
  name: string;
  value: string;
}

export function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
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
