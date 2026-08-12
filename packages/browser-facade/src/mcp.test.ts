import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestrictedBrowserFacade, type BrowserDriver } from './index.js';
import { BROWSER_TOOL_NAMES, browserToolDefinitions } from './mcp.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const driver: BrowserDriver = {
  navigate: vi.fn(async (url: string) => ({ url })),
  snapshot: vi.fn(async () => '- textbox "Password" value="secret-value"'),
  clickByRole: vi.fn(async () => ({ url: 'https://app.example.test/' })),
  fillByLabel: vi.fn(async () => undefined),
  captureScreenshot: vi.fn(async () => undefined),
  captureTrace: vi.fn(async () => undefined),
  diagnostics: vi.fn(async () => ({ console: [], network: [] }))
};

function setup() {
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'qali-mcp-test-'));
  temporaryDirectories.push(evidenceDirectory);
  const facade = new RestrictedBrowserFacade(driver, {
    baseUrl: 'https://app.example.test',
    allowedOrigins: ['https://app.example.test'],
    credentials: { password: 'secret-value' },
    testData: { email: 'alex@example.test' },
    evidenceDirectory
  });
  return new Map(browserToolDefinitions(facade).map((tool) => [tool.name, tool]));
}

describe('browser MCP tool surface', () => {
  it('exports exactly the restricted browser capabilities', () => {
    expect(BROWSER_TOOL_NAMES).toEqual([
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_fill',
      'browser_fill_named',
      'browser_capture_evidence',
      'browser_diagnostics'
    ]);
    expect([...setup().keys()]).toEqual(BROWSER_TOOL_NAMES);
    expect(BROWSER_TOOL_NAMES).not.toContain('browser_evaluate');
    expect(BROWSER_TOOL_NAMES).not.toContain('browser_cookies');
    expect(BROWSER_TOOL_NAMES).not.toContain('browser_download');
    expect(BROWSER_TOOL_NAMES).not.toContain('browser_get_secret');
  });

  it('keeps named values out of tool results and labels snapshots as untrusted data', async () => {
    const tools = setup();
    const fillResult = await tools.get('browser_fill_named')!.handler({
      label: 'Password',
      source: 'credential',
      field: 'password'
    });
    const snapshot = await tools.get('browser_snapshot')!.handler({});

    expect(JSON.stringify(fillResult)).not.toContain('secret-value');
    expect(JSON.stringify(snapshot)).toContain('untrustedPageData');
    expect(JSON.stringify(snapshot)).not.toContain('secret-value');
  });

  it('returns redacted operation failures to the MCP client', async () => {
    const tools = setup();
    vi.mocked(driver.fillByLabel).mockRejectedValueOnce(
      new Error('fill failed while handling secret-value')
    );

    const result = await tools.get('browser_fill_named')!.handler({
      label: 'Password',
      source: 'credential',
      field: 'password'
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});
