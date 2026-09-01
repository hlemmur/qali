import { type Locator, type Page } from '@playwright/test';

export class CartPage {
  constructor(private readonly page: Page) {}

  itemNamed(productName: string): Locator {
    return this.page.getByRole('link', { name: productName });
  }
}
