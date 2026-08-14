import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectExecutionProfileSchema } from '../packages/contracts/src/index.js';
import { resolveBrowserServiceConfig } from '../packages/browser-facade/src/service-config.js';
import {
  parseBrowserMcpEnvironmentFile,
  writeBrowserMcpEnvironmentFile
} from './browser-mcp-env.js';

describe('assembled browser MCP environment', () => {
  it('writes the execution profile path and allowlisted variables so the MCP entrypoint can resolve config', () => {
    const destination = join(mkdtempSync(join(tmpdir(), 'qali-browser-env-')), 'browser.env');
    const executionProfilePath = resolve('projects/_demo/execution-profile.json');
    const evidenceDirectory = join(tmpdir(), 'qali-browser-evidence');
    const profile = ProjectExecutionProfileSchema.parse(
      JSON.parse(readFileSync(executionProfilePath, 'utf8'))
    );

    writeBrowserMcpEnvironmentFile({
      destination,
      executionProfilePath,
      evidenceDirectory,
      profile,
      env: {
        QALI_TARGET_BASE_URL: 'http://127.0.0.1:4173',
        QALI_ALLOWED_ORIGINS_JSON: '["http://127.0.0.1:4173"]',
        QALI_TEST_CREDENTIALS_JSON: '{"password":"demo"}',
        QALI_TEST_DATA_JSON: '{"email":"alex@example.test"}',
        QALI_BROWSER_EXECUTABLE_PATH: '/usr/bin/chromium',
        QALI_CALLBACK_SECRET: 'must-not-leak',
        QALI_WORKER_BASE_URL: 'https://example.invalid',
        QALI_PUBLISH_GITHUB_TOKEN: 'must-not-leak'
      }
    });

    expect(existsSync(destination)).toBe(true);
    const parsed = parseBrowserMcpEnvironmentFile(destination);
    expect(parsed.QALI_EXECUTION_PROFILE_PATH).toBe(executionProfilePath);
    expect(parsed.QALI_BROWSER_EVIDENCE_DIR).toBe(evidenceDirectory);
    expect(parsed.QALI_TARGET_BASE_URL).toBe('http://127.0.0.1:4173');
    expect(parsed.QALI_BROWSER_EXECUTABLE_PATH).toBe('/usr/bin/chromium');
    expect(parsed).not.toHaveProperty('QALI_CALLBACK_SECRET');
    expect(parsed).not.toHaveProperty('QALI_WORKER_BASE_URL');
    expect(parsed).not.toHaveProperty('QALI_PUBLISH_GITHUB_TOKEN');

    const loaded = ProjectExecutionProfileSchema.parse(
      JSON.parse(readFileSync(parsed.QALI_EXECUTION_PROFILE_PATH!, 'utf8'))
    );
    expect(resolveBrowserServiceConfig(loaded, parsed)).toMatchObject({
      baseUrl: 'http://127.0.0.1:4173',
      evidenceDirectory
    });
  });
});
