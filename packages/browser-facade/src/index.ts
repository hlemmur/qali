import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BrowserInteractionResult {
  url: string;
  popupUrls?: string[];
  downloadNames?: string[];
  submitted?: boolean;
}

export interface BrowserDiagnostics {
  console: Array<{ level: string; text: string }>;
  network: Array<{ method: string; url: string; status?: number; blocked?: boolean }>;
}

export interface BrowserDriver {
  navigate(url: string): Promise<{ url: string }>;
  snapshot(): Promise<string>;
  clickByRole(
    role: string,
    name: string,
    policy: { allowSubmission: boolean }
  ): Promise<BrowserInteractionResult>;
  fillByLabel(label: string, value: string): Promise<void>;
  captureScreenshot(path: string, maskedLabels: readonly string[]): Promise<void>;
  captureTrace(path: string): Promise<void>;
  diagnostics(): Promise<BrowserDiagnostics>;
}

export interface RestrictedBrowserConfig {
  baseUrl: string;
  allowedOrigins: string[];
  credentials: Record<string, string>;
  testData: Record<string, string | number | boolean>;
  evidenceDirectory: string;
  allowedSubmissions?: Array<{ role: string; name: string }>;
  redactionPatterns?: string[];
}

export class RestrictedBrowserFacade {
  private readonly allowedOrigins: Set<string>;
  private readonly maskedLabels = new Set<string>();
  private readonly redactors: RegExp[];

  constructor(
    private readonly driver: BrowserDriver,
    private readonly config: RestrictedBrowserConfig
  ) {
    this.allowedOrigins = new Set(config.allowedOrigins.map((value) => new URL(value).origin));
    if (!this.allowedOrigins.has(new URL(config.baseUrl).origin)) {
      throw new Error('Base URL origin is not allowed');
    }
    const exactValues = [...Object.values(config.credentials), ...Object.values(config.testData)]
      .map(String)
      .filter(Boolean)
      .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    this.redactors = [
      ...exactValues.map((value) => new RegExp(value, 'g')),
      ...(config.redactionPatterns ?? []).map((value) => new RegExp(value, 'gi')),
      /Bearer\s+[A-Za-z0-9._~+/-]+/gi,
      /(?:cookie|set-cookie|authorization)\s*[:=]\s*[^\s,;]+/gi
    ];
  }

  private allowedUrl(value: string): URL {
    const url = new URL(value, this.config.baseUrl);
    if (!this.allowedOrigins.has(url.origin)) throw new Error('Origin is not allowed');
    if (url.username || url.password) throw new Error('URLs cannot contain credentials');
    return url;
  }

  async navigate(value: string): Promise<{ url: string }> {
    const requested = this.allowedUrl(value);
    const result = await this.driver.navigate(requested.href);
    return { url: this.allowedUrl(result.url).href };
  }

  async accessibilitySnapshot(): Promise<{ untrustedPageData: string }> {
    return { untrustedPageData: this.redact(await this.driver.snapshot()) };
  }

  async click(role: string, name: string): Promise<{ url: string }> {
    const allowSubmission = (this.config.allowedSubmissions ?? []).some(
      (entry) => entry.role === role && entry.name === name
    );
    const result = await this.driver.clickByRole(role, name, { allowSubmission });
    if (result.popupUrls?.length) throw new Error('Popups are prohibited');
    if (result.downloadNames?.length) throw new Error('Downloads are prohibited');
    if (result.submitted && !allowSubmission) throw new Error('Form submission is not allowed');
    return { url: this.allowedUrl(result.url).href };
  }

  async fill(label: string, value: string): Promise<{ filled: true }> {
    await this.driver.fillByLabel(label, value);
    return { filled: true };
  }

  async fillNamed(
    label: string,
    source: 'credential' | 'testData',
    field: string
  ): Promise<{ filled: true; source: 'credential' | 'testData' }> {
    const values = source === 'credential' ? this.config.credentials : this.config.testData;
    if (!Object.hasOwn(values, field)) {
      throw new Error(
        source === 'credential' ? 'Named credential was not found' : 'Named test data was not found'
      );
    }
    const value = String(values[field]);
    await this.driver.fillByLabel(label, value);
    this.maskedLabels.add(label);
    return { filled: true, source };
  }

  async captureEvidence(
    evidenceId: string,
    options: { screenshot: boolean; trace: boolean }
  ): Promise<{ evidenceId: string; artifacts: string[] }> {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(evidenceId)) {
      throw new Error('Invalid evidence id');
    }
    const directory = join(this.config.evidenceDirectory, evidenceId);
    mkdirSync(directory, { recursive: true });
    const artifacts: string[] = [];
    if (options.screenshot) {
      const reference = `${evidenceId}/screenshot.png`;
      await this.driver.captureScreenshot(join(this.config.evidenceDirectory, reference), [
        ...this.maskedLabels
      ]);
      artifacts.push(reference);
    }
    if (options.trace) {
      const reference = `${evidenceId}/trace.zip`;
      await this.driver.captureTrace(join(this.config.evidenceDirectory, reference));
      artifacts.push(reference);
    }
    const result = { evidenceId, artifacts };
    writeFileSync(join(directory, 'index.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  private redact(value: string): string {
    return this.redactors
      .reduce((output, pattern) => output.replace(pattern, '[REDACTED]'), value)
      .slice(0, 2_000);
  }

  sanitizeForModel(value: unknown): string {
    return this.redact(value instanceof Error ? value.message : String(value));
  }

  async readDiagnostics(): Promise<{
    untrustedConsole: BrowserDiagnostics['console'];
    untrustedNetwork: BrowserDiagnostics['network'];
  }> {
    const raw = await this.driver.diagnostics();
    return {
      untrustedConsole: raw.console.slice(-100).map((entry) => ({
        level: entry.level.slice(0, 32),
        text: this.redact(entry.text)
      })),
      untrustedNetwork: raw.network.slice(-100).map((entry) => {
        let url = '[INVALID URL]';
        try {
          const parsed = new URL(entry.url);
          url = this.redact(`${parsed.origin}${parsed.pathname}`);
        } catch {
          // Keep malformed driver data out of model-visible context.
        }
        return {
          method: entry.method.slice(0, 16),
          url,
          ...(entry.status === undefined ? {} : { status: entry.status }),
          ...(entry.blocked === undefined ? {} : { blocked: entry.blocked })
        };
      })
    };
  }
}
