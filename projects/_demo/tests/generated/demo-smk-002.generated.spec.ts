import { expect, test } from '@playwright/test';

// Approved scenario: DEMO-SMK-002
// Requirements: REQ-002, REQ-005
test('DEMO-SMK-002 generated scenario', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('intruder@example.test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert', { name: 'Email or password is incorrect.' })).toBeVisible();
});
