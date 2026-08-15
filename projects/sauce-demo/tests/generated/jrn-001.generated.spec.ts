import { expect, test } from '@playwright/test';
// Generated from: JRN-001
// Requirements: REQ-001
test('JRN-001 generated scenario @smoke', async ({ page }) => {
  const testData = JSON.parse(process.env.QALI_TEST_DATA_JSON ?? '{}') as Record<string, string>;
  const credentials = JSON.parse(process.env.QALI_TEST_CREDENTIALS_JSON ?? '{}') as Record<
    string,
    string
  >;
  await page.goto('/');
  const usernameValue = String(testData.username ?? '').trim();
  if (!usernameValue) {
    throw new Error('Missing QALI_TEST_DATA_JSON.username');
  }
  await page.getByPlaceholder('Username').fill(usernameValue);
  const passwordValue = String(credentials.password ?? '').trim();
  if (!passwordValue) {
    throw new Error('Missing QALI_TEST_CREDENTIALS_JSON.password');
  }
  await page.getByPlaceholder('Password').fill(passwordValue);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('button', { name: 'Add to cart' }).first()).toBeVisible();
});
