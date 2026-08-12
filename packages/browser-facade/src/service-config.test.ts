import { describe, expect, it } from 'vitest';
import type { ProjectExecutionProfile } from '@qali/contracts';
import { resolveBrowserServiceConfig } from './service-config.js';

const profile: ProjectExecutionProfile = {
  version: 1,
  id: 'demo-mock',
  projectId: '_demo',
  environmentLabel: 'mock',
  targetVariables: {
    baseUrl: 'QALI_TARGET_BASE_URL',
    allowedOrigins: 'QALI_ALLOWED_ORIGINS_JSON',
    credentials: 'QALI_TEST_CREDENTIALS_JSON',
    testData: 'QALI_TEST_DATA_JSON'
  },
  browser: {
    name: 'chromium',
    allowDownloads: false,
    allowPopups: false,
    allowedSubmissions: [{ role: 'button', name: 'Sign in' }]
  },
  rate: { maxActionsPerMinute: 60 },
  mutation: { allowed: ['append-evidence'] },
  cleanup: { strategy: 'fixture-reset' },
  redaction: { patterns: ['token=[^\\s]+'] },
  retention: { evidenceDays: 14 },
  publication: { reviewOnly: true },
  displayBadge: 'MOCK MODE'
};

describe('browser MCP service configuration', () => {
  it('hydrates policy and named values from the trusted profile interface', () => {
    const result = resolveBrowserServiceConfig(profile, {
      QALI_TARGET_BASE_URL: 'http://127.0.0.1:4173',
      QALI_ALLOWED_ORIGINS_JSON: '["http://127.0.0.1:4173"]',
      QALI_TEST_CREDENTIALS_JSON: '{"password":"secret"}',
      QALI_TEST_DATA_JSON: '{"email":"alex@example.test","attempt":2}',
      QALI_BROWSER_EVIDENCE_DIR: '/tmp/qali-evidence'
    });

    expect(result).toMatchObject({
      browserName: 'chromium',
      baseUrl: 'http://127.0.0.1:4173',
      allowedSubmissions: [{ role: 'button', name: 'Sign in' }],
      redactionPatterns: ['token=[^\\s]+'],
      evidenceDirectory: '/tmp/qali-evidence'
    });
    expect(result.credentials).toEqual({ password: 'secret' });
    expect(result.testData).toEqual({ email: 'alex@example.test', attempt: 2 });
  });

  it('rejects relative evidence paths and non-scalar named values', () => {
    const baseEnvironment = {
      QALI_TARGET_BASE_URL: 'http://127.0.0.1:4173',
      QALI_ALLOWED_ORIGINS_JSON: '["http://127.0.0.1:4173"]',
      QALI_TEST_CREDENTIALS_JSON: '{}',
      QALI_TEST_DATA_JSON: '{}',
      QALI_BROWSER_EVIDENCE_DIR: 'relative/evidence'
    };
    expect(() => resolveBrowserServiceConfig(profile, baseEnvironment)).toThrow(
      'must be an absolute path'
    );
    expect(() =>
      resolveBrowserServiceConfig(profile, {
        ...baseEnvironment,
        QALI_BROWSER_EVIDENCE_DIR: '/tmp/qali-evidence',
        QALI_TEST_CREDENTIALS_JSON: '{"nested":{"secret":"value"}}'
      })
    ).toThrow('must contain only scalar values');
  });
});
