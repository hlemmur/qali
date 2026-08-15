import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page';

export class CartPage extends BasePage {
  readonly path = '/cart.html';

  constructor(page: Page) {
    super(page);
  }

  itemByName(productName: string): Locator {
    return this.page.getByRole('link', { name: productName });
  }
}
