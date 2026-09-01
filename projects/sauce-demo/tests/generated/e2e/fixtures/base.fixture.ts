import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page.js';
import { InventoryPage } from '../pages/inventory.page.js';
import { CartPage } from '../pages/cart.page.js';
import { loadDemoCredentials, type DemoCredentials } from '../helpers/test-data.js';

type AppFixtures = {
  credentials: DemoCredentials;
  standardUsername: string;
  demoPassword: string;
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  cartPage: CartPage;
};

export const test = base.extend<AppFixtures>({
  credentials: async ({}, use) => {
    await use(loadDemoCredentials());
  },
  standardUsername: async ({ credentials }, use) => {
    await use(credentials.username);
  },
  demoPassword: async ({ credentials }, use) => {
    await use(credentials.password);
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
