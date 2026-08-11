import { expect, test } from '@playwright/test';

test('DEMO-SMK-001 seeded customer reaches the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('MOCK MODE')).toBeVisible();
  await page.getByLabel('Email').fill('alex@example.test');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Alex Morgan' })).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText('$999,999.99');
  await expect(page.getByText('Coffee House')).toBeVisible();
  await expect(page.getByText('MOCK MODE')).toBeVisible();
});

test('DEMO-SMK-002 invalid credentials are rejected accessibly', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('intruder@example.test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await expect(page.getByRole('heading', { name: 'Good morning, Alex Morgan' })).toBeHidden();
  await expect(page.getByText('MOCK MODE')).toBeVisible();
});

test('DEMO-VIS-001 captures deterministic dashboard evidence @visual', async ({
  page
}, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('alex@example.test');
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Good morning, Alex Morgan' })).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('dashboard-evidence.png'),
    fullPage: true,
    animations: 'disabled'
  });
});
