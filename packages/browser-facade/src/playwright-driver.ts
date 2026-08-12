import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page
} from '@playwright/test';
import type { BrowserDiagnostics, BrowserDriver, BrowserInteractionResult } from './index.js';

export interface PlaywrightBrowserDriverOptions {
  allowedOrigins: string[];
  browserName?: 'chromium' | 'firefox' | 'webkit';
  executablePath?: string;
}

export class PlaywrightBrowserDriver implements BrowserDriver {
  private readonly consoleEntries: BrowserDiagnostics['console'] = [];
  private readonly networkEntries: BrowserDiagnostics['network'] = [];
  private readonly popupUrls: string[] = [];
  private readonly downloadNames: string[] = [];
  private blockedRequests = 0;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly allowedOrigins: Set<string>
  ) {}

  static async launch(options: PlaywrightBrowserDriverOptions): Promise<PlaywrightBrowserDriver> {
    const browserName = options.browserName ?? 'chromium';
    const executablePath =
      options.executablePath ??
      (browserName === 'chromium' && process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined);
    const browserType = { chromium, firefox, webkit }[browserName];
    const browser = await browserType.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {})
    });
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    const driver = new PlaywrightBrowserDriver(
      browser,
      context,
      page,
      new Set(options.allowedOrigins.map((value) => new URL(value).origin))
    );
    await driver.installPolicy();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    return driver;
  }

  private async installPolicy(): Promise<void> {
    await this.context.route('**/*', async (route) => {
      const request = route.request();
      const rawUrl = request.url();
      let allowed: boolean;
      try {
        const url = new URL(rawUrl);
        allowed = this.allowedOrigins.has(url.origin);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        this.blockedRequests += 1;
        this.networkEntries.push({ method: request.method(), url: rawUrl, blocked: true });
        await route.abort('blockedbyclient');
        return;
      }
      if (request.isNavigationRequest() && request.resourceType() === 'document') {
        const response = await route.fetch({ maxRedirects: 0 });
        const headers = response.headers();
        const contentDisposition = headers['content-disposition'];
        if (/^\s*attachment(?:;|$)/i.test(contentDisposition ?? '')) {
          this.blockedRequests += 1;
          this.downloadNames.push('blocked-download');
          this.networkEntries.push({
            method: request.method(),
            url: rawUrl,
            status: response.status(),
            blocked: true
          });
          await route.fulfill({
            status: 403,
            contentType: 'text/plain',
            body: 'Blocked by browser policy'
          });
          return;
        }
        const location = headers.location;
        if (location) {
          const redirectUrl = new URL(location, rawUrl);
          if (!this.allowedOrigins.has(redirectUrl.origin)) {
            this.blockedRequests += 1;
            this.networkEntries.push({
              method: request.method(),
              url: redirectUrl.href,
              status: response.status(),
              blocked: true
            });
            await route.fulfill({
              status: 403,
              contentType: 'text/plain',
              body: 'Blocked by browser policy'
            });
            return;
          }
        }
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });
    this.page.on('console', (message) => {
      this.consoleEntries.push({ level: message.type(), text: message.text() });
    });
    this.page.on('response', (response) => {
      this.networkEntries.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status()
      });
    });
    this.page.on('popup', (popup) => {
      this.popupUrls.push(popup.url());
      void popup.close();
    });
    this.page.on('download', (download) => {
      this.downloadNames.push(download.suggestedFilename());
      void download.cancel();
    });
  }

  async navigate(url: string): Promise<{ url: string }> {
    const blockedBefore = this.blockedRequests;
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (this.blockedRequests > blockedBefore) {
        throw new Error('Navigation blocked by policy', { cause: error });
      }
      throw error;
    }
    if (this.blockedRequests > blockedBefore) throw new Error('Navigation blocked by policy');
    return { url: this.page.url() };
  }

  async snapshot(): Promise<string> {
    return this.page.locator('body').ariaSnapshot();
  }

  async clickByRole(
    role: string,
    name: string,
    policy: { allowSubmission: boolean }
  ): Promise<BrowserInteractionResult> {
    const locator = this.page.getByRole(role as Parameters<Page['getByRole']>[0], {
      name,
      exact: true
    });
    const action = await locator.evaluate((element) => {
      let form: HTMLFormElement | null = null;
      if (element instanceof HTMLInputElement) {
        if (element.type === 'submit' || element.type === 'image') form = element.form;
      }
      if (element instanceof HTMLButtonElement) {
        if (element.type === 'submit') form = element.form;
      }
      return {
        submission: form
          ? { submits: true as const, method: form.method.toUpperCase() }
          : { submits: false as const },
        triggersDownload: element instanceof HTMLAnchorElement && element.hasAttribute('download')
      };
    });
    if (action.triggersDownload) throw new Error('Downloads are prohibited');
    if (action.submission.submits && !policy.allowSubmission) {
      throw new Error('Form submission is not allowed');
    }
    if (action.submission.submits && action.submission.method !== 'POST') {
      throw new Error('Form submissions must use POST');
    }

    const popupOffset = this.popupUrls.length;
    const downloadOffset = this.downloadNames.length;
    const blockedOffset = this.blockedRequests;
    try {
      await locator.click();
    } catch (error) {
      if (this.downloadNames.length === downloadOffset) {
        if (this.blockedRequests > blockedOffset) {
          throw new Error('Network escape blocked by policy', { cause: error });
        }
        throw error;
      }
    }
    await this.page.waitForTimeout(25);
    if (this.downloadNames.length === downloadOffset && this.blockedRequests > blockedOffset) {
      throw new Error('Network escape blocked by policy');
    }
    return {
      url: this.page.url(),
      ...(this.popupUrls.length > popupOffset
        ? { popupUrls: this.popupUrls.slice(popupOffset) }
        : {}),
      ...(this.downloadNames.length > downloadOffset
        ? { downloadNames: this.downloadNames.slice(downloadOffset) }
        : {}),
      ...(action.submission.submits ? { submitted: true } : {})
    };
  }

  async fillByLabel(label: string, value: string): Promise<void> {
    await this.page.getByLabel(label, { exact: true }).fill(value);
  }

  async captureScreenshot(path: string, maskedLabels: readonly string[]): Promise<void> {
    await this.page.screenshot({
      path,
      fullPage: true,
      animations: 'disabled',
      mask: maskedLabels.map((label) => this.page.getByLabel(label, { exact: true }))
    });
  }

  async captureTrace(path: string): Promise<void> {
    await this.context.tracing.stop({ path });
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  }

  async diagnostics(): Promise<BrowserDiagnostics> {
    return {
      console: this.consoleEntries.slice(-100),
      network: this.networkEntries.slice(-100)
    };
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }
}
