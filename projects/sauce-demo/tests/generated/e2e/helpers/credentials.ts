/**
 * DATA-001 / DATA-002 — named fills per D-003.
 * Password values must never be committed or echoed in artifacts.
 */
export type DemoCredentials = {
  username: string;
  password: string;
};

export function loadDemoCredentials(): DemoCredentials {
  const testDataRaw = process.env.QALI_TEST_DATA_JSON;
  const credentialsRaw = process.env.QALI_TEST_CREDENTIALS_JSON;

  if (!testDataRaw) {
    throw new Error('QALI_TEST_DATA_JSON is required (DATA-001 username)');
  }
  if (!credentialsRaw) {
    throw new Error('QALI_TEST_CREDENTIALS_JSON is required (DATA-002 password)');
  }

  const testData = JSON.parse(testDataRaw) as { username?: string };
  const credentials = JSON.parse(credentialsRaw) as { password?: string };

  if (!testData.username) {
    throw new Error('QALI_TEST_DATA_JSON.username is required (DATA-001)');
  }
  if (!credentials.password) {
    throw new Error('QALI_TEST_CREDENTIALS_JSON.password is required (DATA-002)');
  }

  return {
    username: testData.username,
    password: credentials.password
  };
}
