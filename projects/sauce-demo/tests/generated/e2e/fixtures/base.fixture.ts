import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { InventoryPage } from '../pages/inventory.page';
import { getCredentials, getTestData } from '../helpers/credentials';

type HarnessFixtures = {
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  standardUsername: string;
  demoPassword: string;
};

export const test = base.extend<HarnessFixtures>({
  standardUsername: async (_fixtures, use) => {
    await use(getTestData().username);
  },
  demoPassword: async (_fixtures, use) => {
    await use(getCredentials().password);
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  inventoryPage: async ({ page }, use) => {
    await use(new InventoryPage(page));
  }
});

export { expect } from '@playwright/test';
