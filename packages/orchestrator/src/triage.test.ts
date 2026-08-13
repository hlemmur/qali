import { describe, expect, it } from 'vitest';
import { fingerprintFailureReport } from './triage.js';

const failureReport = (error: string, duration: number) => ({
  suites: [
    {
      title: 'tests/checkout.spec.ts',
      specs: [
        {
          title: 'CHK-001 checkout rejects an expired card',
          file: 'tests/checkout.spec.ts',
          tests: [
            {
              projectName: 'functional-chromium',
              status: 'unexpected',
              results: [
                {
                  status: 'failed',
                  duration,
                  errors: [{ message: error }]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
});

describe('failure triage', () => {
  it('creates a stable deterministic fingerprint from failure identity, not run noise', () => {
    const first = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-1',
      report: failureReport(
        '\u001b[31mExpected decline banner after 30000ms\u001b[39m\n    at /tmp/a/checkout.spec.ts:19:4',
        30_041
      )
    });
    const repeated = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-2',
      report: failureReport(
        'Expected decline banner after 29987ms\n    at /different/root/checkout.spec.ts:21:7',
        29_992
      )
    });
    const changed = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-3',
      report: failureReport('Expected receipt heading', 30_000)
    });

    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(first).toMatchObject({
      version: 1,
      sourceRunId: 'run-1',
      projectId: 'shop',
      failureCount: 1,
      failures: [
        {
          title: 'CHK-001 checkout rejects an expired card',
          projectName: 'functional-chromium',
          file: 'tests/checkout.spec.ts',
          error: 'Expected decline banner after <duration>'
        }
      ]
    });
  });
});
