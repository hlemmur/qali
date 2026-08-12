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
  private blockedDocumentNavigations = 0;
  private pendingSubmissionApproval = false;

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
    // Snapshots omitted: DOM snapshots can retain filled credential values.
    await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    return driver;
  }

  private recordBlocked(
    method: string,
    url: string,
    options: { status?: number; documentNavigation?: boolean } = {}
  ): void {
    this.blockedRequests += 1;
    if (options.documentNavigation) this.blockedDocumentNavigations += 1;
    this.networkEntries.push({
      method,
      url,
      ...(options.status === undefined ? {} : { status: options.status }),
      blocked: true
    });
  }

  private async installPolicy(): Promise<void> {
    await this.context.route('**/*', async (route) => {
      const request = route.request();
      const rawUrl = request.url();
      const isDocumentNavigation =
        request.isNavigationRequest() && request.resourceType() === 'document';
      let allowed: boolean;
      try {
        const url = new URL(rawUrl);
        allowed = this.allowedOrigins.has(url.origin);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        this.recordBlocked(request.method(), rawUrl, { documentNavigation: isDocumentNavigation });
        await route.abort('blockedbyclient');
        return;
      }

      if (isDocumentNavigation && request.method().toUpperCase() === 'POST') {
        if (!this.pendingSubmissionApproval) {
          this.recordBlocked(request.method(), rawUrl, { documentNavigation: true });
          await route.fulfill({
            status: 403,
            contentType: 'text/plain',
            body: 'Blocked by browser policy'
          });
          return;
        }
        this.pendingSubmissionApproval = false;
      }

      const response =
        isDocumentNavigation ||
        request.resourceType() === 'xhr' ||
        request.resourceType() === 'fetch'
          ? await route.fetch({ maxRedirects: 0 })
          : null;
      if (!response) {
        await route.continue();
        return;
      }
      const headers = response.headers();
      const contentDisposition = headers['content-disposition'];
      if (/^\s*attachment(?:;|$)/i.test(contentDisposition ?? '')) {
        this.recordBlocked(request.method(), rawUrl, {
          status: response.status(),
          documentNavigation: isDocumentNavigation
        });
        this.downloadNames.push('blocked-download');
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
          this.recordBlocked(request.method(), redirectUrl.href, {
            status: response.status(),
            documentNavigation: isDocumentNavigation
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
    this.context.on('page', (page) => {
      if (page === this.page) return;
      this.popupUrls.push(page.url() || 'about:blank');
      void page.close();
    });
    this.page.on('download', (download) => {
      this.downloadNames.push(download.suggestedFilename());
      void download.cancel();
    });
  }

  async navigate(url: string): Promise<{ url: string }> {
    const blockedDocumentsBefore = this.blockedDocumentNavigations;
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (this.blockedDocumentNavigations > blockedDocumentsBefore) {
        throw new Error('Navigation blocked by policy', { cause: error });
      }
      throw error;
    }
    // Allow page scripts (e.g. auto-submit forms) to hit the POST gate before returning.
    await this.page.waitForTimeout(50);
    if (this.blockedDocumentNavigations > blockedDocumentsBefore) {
      throw new Error('Navigation blocked by policy');
    }
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
      let submitterMethod: string | undefined;
      if (element instanceof HTMLInputElement) {
        if (element.type === 'submit' || element.type === 'image') {
          form = element.form;
          submitterMethod = element.formMethod || undefined;
        }
      }
      if (element instanceof HTMLButtonElement) {
        if (element.type === 'submit' || element.getAttribute('type') === null) {
          // Default button type inside a form is submit.
          if (element.type === 'submit' || element.form) {
            form = element.form;
            submitterMethod = element.formMethod || undefined;
          }
        }
      }
      if (!form && element instanceof HTMLElement) {
        form = element.closest('form');
      }
      const method = (submitterMethod || form?.method || 'get').toUpperCase();
      return {
        submission: form ? { submits: true as const, method } : { submits: false as const },
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
    if (action.submission.submits && policy.allowSubmission) {
      this.pendingSubmissionApproval = true;
    }
    try {
      await locator.click();
    } catch (error) {
      this.pendingSubmissionApproval = false;
      if (this.downloadNames.length === downloadOffset) {
        if (this.blockedRequests > blockedOffset) {
          throw new Error('Network escape blocked by policy', { cause: error });
        }
        throw error;
      }
    }
    const settleDeadline = Date.now() + 500;
    while (
      Date.now() < settleDeadline &&
      this.popupUrls.length === popupOffset &&
      this.downloadNames.length === downloadOffset &&
      this.blockedRequests === blockedOffset
    ) {
      await this.page.waitForTimeout(25);
    }
    await this.page.waitForTimeout(50);
    if (this.downloadNames.length === downloadOffset && this.blockedRequests > blockedOffset) {
      this.pendingSubmissionApproval = false;
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
    await this.context.tracing.start({ screenshots: true, snapshots: false, sources: false });
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
