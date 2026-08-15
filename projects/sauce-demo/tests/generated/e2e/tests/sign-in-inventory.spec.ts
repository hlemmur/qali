import { expect, test } from '../../fixtures/base.fixture';
/**
 * Scenario: SCN-SMK-001 — Sign in and view inventory
 * Requirement: REQ-001 (A visitor can sign in with a named demo account and reach the product inventory.)
 * Journey: JRN-001
 * Priority: P0
 */
test('sign in with named demo account and view inventory @smoke', async ({
  credentials,
  loginPage,
  inventoryPage
}) => {
  await test.step('open login page', async () => {
    await loginPage.goto();
    await expect(loginPage.loginButton).toBeVisible();
  });
  await test.step('submit named credentials', async () => {
    await loginPage.signIn(credentials.username, credentials.password);
  });
  await test.step('verify inventory is visible', async () => {
    await expect(inventoryPage.firstAddToCartButton()).toBeVisible();
    await expect(loginPage.errorMessage).not.toBeVisible();
  });
});
