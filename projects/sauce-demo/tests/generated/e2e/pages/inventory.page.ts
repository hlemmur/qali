import { type Locator, type Page } from '@playwright/test';

export class InventoryPage {
  readonly addToCartButtons: Locator;
  readonly productTitles: Locator;
  readonly cartLink: Locator;

  removeButtons: Locator;

  constructor(private readonly page: Page) {
    this.addToCartButtons = page.getByRole('button', { name: 'Add to cart' });
    this.productTitles = page.getByTestId('inventory-item-name');
    this.cartLink = page.getByTestId('shopping-cart-link');
    this.removeButtons = page.getByRole('button', { name: 'Remove' });
  }

  firstAddToCartButton(): Locator {
    return this.addToCartButtons.first();
  }

  async firstProductTitle(): Promise<string> {
    const title = await this.productTitles.first().textContent();
    if (!title) {
      throw new Error('No inventory product title found');
    }
    return title.trim();
  }

  async addFirstProductToCart(): Promise<string> {
    const productName = await this.firstProductTitle();
    await this.firstAddToCartButton().click();
    return productName;
  }

  async openCart(): Promise<void> {
    await this.cartLink.click();
  }
}
