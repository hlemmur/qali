import { expect, test } from '../../fixtures/base.fixture';
/**
 * Scenario: SCN-SMK-002 — Add a product to the cart
 * Requirement: REQ-002 (An authenticated shopper can add a product to the cart from inventory.)
 * Journey: JRN-002
 * Priority: P0
 */
test('add first inventory product to cart @smoke', async ({
  credentials,
  loginPage,
  inventoryPage,
  cartPage
}) => {
  let selectedProduct = '';
  await test.step('authenticate on inventory', async () => {
    await loginPage.goto();
    await loginPage.signIn(credentials.username, credentials.password);
    await expect(inventoryPage.firstAddToCartButton()).toBeVisible();
  });
  await test.step('add first available product', async () => {
    selectedProduct = await inventoryPage.addFirstProductToCart();
    await expect(inventoryPage.removeButtons.first()).toBeVisible();
  });
  await test.step('open cart and verify product is listed', async () => {
    await inventoryPage.openCart();
    await expect(cartPage.cartItems).not.toHaveCount(0);
    await expect(cartPage.itemNamed(selectedProduct)).toBeVisible();
  });
});
