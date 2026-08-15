import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page';

export class InventoryPage extends BasePage {
  readonly path = '/inventory.html';

  constructor(page: Page) {
    super(page);
  }

  firstAddToCartButton(): Locator {
    return this.page.getByRole('button', { name: 'Add to cart' }).first();
  }

  firstInventoryItem(): Locator {
    return this.page.getByTestId('inventory-item').first();
  }

  firstProductName(): Locator {
    return this.firstInventoryItem().getByRole('link');
  }

  cartLink(): Locator {
    return this.page.getByTestId('shopping-cart-link');
  }

  async addFirstProductToCart(): Promise<string> {
    const productName = await this.firstProductName().innerText();
    await this.firstInventoryItem().getByRole('button', { name: 'Add to cart' }).click();
    return productName;
  }

  async openCart(): Promise<void> {
    await this.cartLink().click();
  }
}
