import { test } from '@playwright/test';

// Approved scenario: DEMO-VIS-001
// Requirements: REQ-003, REQ-005
test('DEMO-VIS-001 generated scenario', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('alex@example.test');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Evidence-only screenshot; not a visual assertion.
  await page.screenshot({
    path: testInfo.outputPath('dashboard-run-evidence.png'),
    fullPage: true
  });
});
