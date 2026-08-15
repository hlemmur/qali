import { LOCKED_OUT_USERNAME } from '../../helpers/test-data';
import { expect, test } from '../../fixtures/base.fixture';
/**
 * Scenario: JRN-001 — Sign in and view inventory
 * Requirement: REQ-001 (A visitor can sign in with a named demo account and reach the product inventory)
 * Priority: P0
 */
test('signs in with named demo account and reaches inventory @smoke', async ({
  page,
  loginPage,
  inventoryPage,
  testData,
  credentials
}) => {
  await test.step('open login page', async () => {
    await loginPage.goto();
  });
  await test.step('submit named credentials', async () => {
    await loginPage.login(testData.username, credentials.password);
  });
  await test.step('verify inventory is reachable', async () => {
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(inventoryPage.firstAddToCartButton()).toBeVisible();
  });
});
/**
 * Scenario: SC-NEG-001 — Locked account does not reach inventory
 * Requirement: REQ-003 (Invalid or locked accounts do not reach inventory)
 * Priority: P0
 */
test('rejects locked out account before inventory @smoke', async ({
  page,
  loginPage,
  inventoryPage,
  credentials
}) => {
  await loginPage.goto();
  await loginPage.login(LOCKED_OUT_USERNAME, credentials.password);
  await expect(page).not.toHaveURL(/inventory\.html/);
  await expect(inventoryPage.firstAddToCartButton()).toHaveCount(0);
  await expect(page.getByText(/locked out/i)).toBeVisible();
});
