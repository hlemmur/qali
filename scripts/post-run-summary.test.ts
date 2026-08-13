import { describe, expect, it } from 'vitest';
import { callbackAuthenticationHeaders, resolveSlackRunStatus } from './post-run-summary.js';

describe('resolveSlackRunStatus', () => {
  it('overrides a passed report when the Actions job failed', () => {
    expect(resolveSlackRunStatus('failure', 'passed')).toBe('failed');
  });

  it('overrides a passed report when the Actions job was cancelled', () => {
    expect(resolveSlackRunStatus('cancelled', 'passed')).toBe('failed');
  });

  it('keeps the report status when the job succeeded', () => {
    expect(resolveSlackRunStatus('success', 'passed')).toBe('passed');
    expect(resolveSlackRunStatus('success', 'failed')).toBe('failed');
  });

  it('falls back to job outcome when no report status exists', () => {
    expect(resolveSlackRunStatus('success', undefined)).toBe('passed');
    expect(resolveSlackRunStatus('unknown', undefined)).toBe('unknown');
  });
});

describe('callbackAuthenticationHeaders', () => {
  it('binds the timestamp, nonce, and body into the callback signature', () => {
    expect(
      callbackAuthenticationHeaders(
        'callback-secret',
        '{"requestId":"Ev1"}',
        1_700_000_000,
        'run-42-attempt-1'
      )
    ).toEqual({
      'x-qali-timestamp': '1700000000',
      'x-qali-nonce': 'run-42-attempt-1',
      'x-qali-signature': 'sha256=fa6a70c5531210a353ae03aa5708b7d049fc105cf0e1fd6a2152de5991ee83da'
    });
  });
});
