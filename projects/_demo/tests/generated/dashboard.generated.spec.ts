import { expect, test } from '@playwright/test';

test('DEMO-GEN-001 generated dashboard journey', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('alex@example.test');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Good morning, Alex Morgan' })).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText('$12,480.50');
});
