import { describe, expect, it } from 'vitest';
import { resolveSlackRunStatus } from './post-run-summary.js';

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
