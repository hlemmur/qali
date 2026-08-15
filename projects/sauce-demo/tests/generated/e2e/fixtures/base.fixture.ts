import { test as base, expect } from '@playwright/test';
import {
  loadCredentials,
  loadTestData,
  type TestCredentials,
  type TestData
} from '../helpers/test-data';
import { CartPage } from '../pages/cart.page';
import { InventoryPage } from '../pages/inventory.page';
import { LoginPage } from '../pages/login.page';

type AppFixtures = {
  testData: TestData;
  credentials: TestCredentials;
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  cartPage: CartPage;
  authenticatedInventory: InventoryPage;
};

export const test = base.extend<AppFixtures>({
  testData: async ({}, use) => {
    await use(loadTestData());
  },

  credentials: async ({}, use) => {
    await use(loadCredentials());
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  inventoryPage: async ({ page }, use) => {
    await use(new InventoryPage(page));
  },

  cartPage: async ({ page }, use) => {
    await use(new CartPage(page));
  },

  authenticatedInventory: async ({ loginPage, inventoryPage, testData, credentials }, use) => {
    await loginPage.goto();
    await loginPage.login(testData.username, credentials.password);
    await expect(inventoryPage.firstAddToCartButton()).toBeVisible();
    await use(inventoryPage);
  }
});

export { expect } from '@playwright/test';
