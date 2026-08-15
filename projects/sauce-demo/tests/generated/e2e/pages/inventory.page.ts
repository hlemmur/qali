import { type Locator, type Page } from '@playwright/test';

export class InventoryPage {
  readonly path = '/inventory.html';
  readonly title: Locator;
  readonly addToCartButtons: Locator;

  constructor(page: Page) {
    this.title = page.getByText('Products', { exact: true });
    this.addToCartButtons = page.getByRole('button', { name: 'Add to cart' });
  }
}
