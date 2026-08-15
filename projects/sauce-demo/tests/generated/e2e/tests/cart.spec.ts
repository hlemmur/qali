import { expect, test } from '../../fixtures/base.fixture';
/**
 * Scenario: JRN-002 — Add a product to the cart
 * Requirement: REQ-002 (An authenticated shopper can add a product to the cart from inventory)
 * Priority: P0
 */
test('adds a product to the cart from inventory @smoke', async ({
  page,
  authenticatedInventory,
  cartPage
}) => {
  let productName = '';
  await test.step('add first inventory item to cart', async () => {
    productName = await authenticatedInventory.addFirstProductToCart();
  });
  await test.step('open cart and verify selected product', async () => {
    await authenticatedInventory.openCart();
    await expect(page).toHaveURL(/cart\.html/);
    await expect(cartPage.itemByName(productName)).toBeVisible();
  });
});
