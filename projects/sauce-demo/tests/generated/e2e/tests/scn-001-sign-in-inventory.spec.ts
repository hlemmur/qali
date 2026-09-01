import { test, expect } from '../fixtures/base.fixture.js';
/**
 * Scenario: SCN-001 — Sign in and view inventory
 * Requirement: REQ-001 (named demo account reaches product inventory)
 * Journey: JRN-001
 * Risks: RSK-001, RSK-002
 * Priority: P0
 */
test('sign in with named credentials and view inventory @smoke', async ({
  loginPage,
  inventoryPage,
  credentials
}) => {
  await test.step('open login page', async () => {
    await loginPage.goto();
    await expect(loginPage.loginButton).toBeVisible();
  });
  await test.step('submit named credentials', async () => {
    await loginPage.signIn(credentials.username, credentials.password);
  });
  await test.step('verify inventory is reachable', async () => {
    await expect(inventoryPage.firstAddToCartButton()).toBeVisible();
    await expect(loginPage.loginButton).not.toBeVisible();
  });
});
