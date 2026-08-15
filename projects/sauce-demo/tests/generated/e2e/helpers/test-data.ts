export type TestData = {
  username: string;
};

export type TestCredentials = {
  password: string;
};

/** DATA-001 — happy-path demo username from QALI_TEST_DATA_JSON */
export function loadTestData(): TestData {
  const raw = process.env.QALI_TEST_DATA_JSON;
  if (!raw) {
    throw new Error('QALI_TEST_DATA_JSON is required');
  }

  const parsed = JSON.parse(raw) as TestData;
  if (!parsed.username) {
    throw new Error('QALI_TEST_DATA_JSON.username is required');
  }

  return parsed;
}

/** DATA-002 — named credential from QALI_TEST_CREDENTIALS_JSON; never log or commit */
export function loadCredentials(): TestCredentials {
  const raw = process.env.QALI_TEST_CREDENTIALS_JSON;
  if (!raw) {
    throw new Error('QALI_TEST_CREDENTIALS_JSON is required');
  }

  const parsed = JSON.parse(raw) as TestCredentials;
  if (!parsed.password) {
    throw new Error('QALI_TEST_CREDENTIALS_JSON.password is required');
  }

  return parsed;
}

/**
 * REQ-003 negative-path account.
 * Status: inferred — standard Sauce Demo locked account; confirm before promoting to confirmed.
 */
export const LOCKED_OUT_USERNAME = 'locked_out_user';
