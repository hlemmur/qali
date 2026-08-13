import { describe, expect, it } from 'vitest';
import { reportObjectKey, signReportAccess, verifyReportAccess } from './report-access.js';

describe('hosted report access', () => {
  it('builds a stable object key from project and run ids', () => {
    expect(reportObjectKey('sauce-demo', '42')).toBe('sauce-demo/42.html');
  });

  it('rejects path traversal in object keys', () => {
    expect(() => reportObjectKey('../secret', '42')).toThrow(/project/i);
    expect(() => reportObjectKey('sauce-demo', '1/../2')).toThrow(/run/i);
  });

  it('signs and verifies a time-limited report URL', async () => {
    const signed = await signReportAccess({
      baseUrl: 'https://qali-slack-control.example.workers.dev',
      key: 'sauce-demo/42.html',
      secret: 'callback-secret',
      expiresAtSeconds: 1_700_000_100
    });
    expect(signed.url).toContain('/reports/sauce-demo/42.html');
    expect(signed.url).toContain('exp=1700000100');
    expect(
      await verifyReportAccess({
        key: 'sauce-demo/42.html',
        secret: 'callback-secret',
        expiresAtSeconds: 1_700_000_100,
        signature: signed.signature,
        nowSeconds: 1_700_000_000
      })
    ).toBe(true);
    expect(
      await verifyReportAccess({
        key: 'sauce-demo/42.html',
        secret: 'other-secret',
        expiresAtSeconds: 1_700_000_100,
        signature: signed.signature,
        nowSeconds: 1_700_000_000
      })
    ).toBe(false);
    expect(
      await verifyReportAccess({
        key: 'sauce-demo/42.html',
        secret: 'callback-secret',
        expiresAtSeconds: 1_700_000_100,
        signature: signed.signature,
        nowSeconds: 1_700_000_101
      })
    ).toBe(false);
  });
});
