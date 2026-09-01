import { test, expect } from '../fixtures/base.fixture.js';
/**
 * Scenario: SCN-002 — Add a product to the cart
 * Requirement: REQ-002 (authenticated shopper adds product from inventory)
 * Journey: JRN-002
 * Risks: RSK-001, RSK-003
 * Priority: P0
 */
test('add first inventory product to cart @smoke', async ({
  loginPage,
  inventoryPage,
  cartPage,
  credentials
}) => {
  await test.step('authenticate on inventory', async () => {
    await loginPage.goto();
    await loginPage.signIn(credentials.username, credentials.password);
    await expect(inventoryPage.firstAddToCartButton()).toBeVisible();
  });
  let selectedProduct = '';
  await test.step('add a product and open cart', async () => {
    selectedProduct = await inventoryPage.addFirstProductToCart();
    expect(selectedProduct.length).toBeGreaterThan(0);
    await inventoryPage.openCart();
  });
  await test.step('verify selected product appears in cart', async () => {
    await expect(cartPage.itemNamed(selectedProduct)).toBeVisible();
    await expect(cartPage.itemNamed(selectedProduct)).toHaveCount(1);
  });
});
