import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page.js';
import { InventoryPage } from '../pages/inventory.page.js';
import { CartPage } from '../pages/cart.page.js';
import { loadDemoCredentials, type DemoCredentials } from '../helpers/test-data.js';

type AppFixtures = {
  credentials: DemoCredentials;
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  cartPage: CartPage;
};

export const test = base.extend<AppFixtures>({
  credentials: async ({}, use) => {
    await use(loadDemoCredentials());
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  inventoryPage: async ({ page }, use) => {
    await use(new InventoryPage(page));
  },
  cartPage: async ({ page }, use) => {
    await use(new CartPage(page));
  }
});

export { expect };
