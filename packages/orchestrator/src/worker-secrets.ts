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
