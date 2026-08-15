/**
 * Loads named test data and credentials from harness environment variables.
 * References: DATA-001, DATA-002, D-003, CTX-011
 */

export type QaliTestData = {
  username: string;
};

export type QaliCredentials = {
  password: string;
};

function parseJsonEnv<T>(name: string): T {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} is required but was not set`);
  }
  return JSON.parse(raw) as T;
}

export function getTestData(): QaliTestData {
  const data = parseJsonEnv<QaliTestData>('QALI_TEST_DATA_JSON');
  if (!data.username) {
    throw new Error('QALI_TEST_DATA_JSON.username is required');
  }
  return data;
}

export function getCredentials(): QaliCredentials {
  const creds = parseJsonEnv<QaliCredentials>('QALI_TEST_CREDENTIALS_JSON');
  if (!creds.password) {
    throw new Error('QALI_TEST_CREDENTIALS_JSON.password is required');
  }
  return creds;
}
