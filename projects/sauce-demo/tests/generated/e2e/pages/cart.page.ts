import { type Locator, type Page } from '@playwright/test';

export class CartPage {
  readonly itemNames: Locator;
  readonly cartItems: Locator;

  constructor(private readonly page: Page) {
    this.itemNames = page.getByTestId('inventory-item-name');
    this.cartItems = page.locator('[data-test="inventory-item"]');
  }

  itemNamed(productName: string): Locator {
    return this.itemNames.filter({ hasText: productName });
  }
}
