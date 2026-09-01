export type DemoCredentials = {
  username: string;
  password: string;
};

function parseJsonEnv(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
}

/**
 * DATA-001 / DATA-002: named fills from harness env vars; never hardcode secrets.
 */
export function loadDemoCredentials(): DemoCredentials {
  const testData = parseJsonEnv('QALI_TEST_DATA_JSON');
  const credentials = parseJsonEnv('QALI_TEST_CREDENTIALS_JSON');

  const username = testData.username ?? 'standard_user';
  const password = credentials.password;

  if (!password) {
    throw new Error(
      'Missing demo password. Set QALI_TEST_CREDENTIALS_JSON with a named "password" field.'
    );
  }

  return { username, password };
}
