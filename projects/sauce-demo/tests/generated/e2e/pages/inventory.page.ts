import { type Locator, type Page } from '@playwright/test';

export class InventoryPage {
  readonly title: Locator;
  readonly addToCartButtons: Locator;
  readonly cartLink: Locator;
  readonly inventoryItems: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByText('Products', { exact: true });
    this.addToCartButtons = page.getByRole('button', { name: 'Add to cart' });
    this.cartLink = page.getByTestId('shopping-cart-link');
    this.inventoryItems = page.getByTestId('inventory-item-name');
  }

  firstAddToCartButton(): Locator {
    return this.addToCartButtons.first();
  }

  async firstProductName(): Promise<string> {
    const text = await this.inventoryItems.first().textContent();
    return text?.trim() ?? '';
  }

  async addFirstProductToCart(): Promise<string> {
    const productName = await this.firstProductName();
    await this.firstAddToCartButton().click();
    return productName;
  }

  async openCart(): Promise<void> {
    await this.cartLink.click();
  }
}
