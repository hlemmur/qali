import type { NormalizedCommand } from '../packages/contracts/src/index.js';

export type FailureSummaryAction =
  'preserve-executor-summary' | 'write-playwright-fallback' | 'write-workflow-fallback';

export function failureSummaryAction(input: {
  intent: NormalizedCommand['intent'];
  resultsExist: boolean;
  executorSummaryExists: boolean;
}): FailureSummaryAction {
  if (input.executorSummaryExists) return 'preserve-executor-summary';
  if (input.intent === 'run-test-suite' && input.resultsExist) {
    return 'write-playwright-fallback';
  }
  return 'write-workflow-fallback';
}

export function shouldWriteFallbackPlaywrightSummary(input: {
  intent: NormalizedCommand['intent'];
  resultsExist: boolean;
  executorSummaryExists: boolean;
}): boolean {
  return failureSummaryAction(input) === 'write-playwright-fallback';
}
