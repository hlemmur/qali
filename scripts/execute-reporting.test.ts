import { describe, expect, it } from 'vitest';
import { failureSummaryAction, shouldWriteFallbackPlaywrightSummary } from './execute-reporting.js';

describe('execute reporting handoff', () => {
  it('preserves the executor summary when deterministic execution already wrote one', () => {
    expect(
      shouldWriteFallbackPlaywrightSummary({
        intent: 'run-test-suite',
        resultsExist: true,
        executorSummaryExists: true
      })
    ).toBe(false);
  });

  it('writes a fallback only when results exist without an executor summary', () => {
    expect(
      shouldWriteFallbackPlaywrightSummary({
        intent: 'run-test-suite',
        resultsExist: true,
        executorSummaryExists: false
      })
    ).toBe(true);
  });

  it('preserves rich counts and suite context after a failed executor run', () => {
    expect(
      failureSummaryAction({
        intent: 'run-test-suite',
        resultsExist: true,
        executorSummaryExists: true
      })
    ).toBe('preserve-executor-summary');
  });
});
