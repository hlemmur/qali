import type { NormalizedCommand } from '../packages/contracts/src/index.js';

export function shouldWriteFallbackPlaywrightSummary(input: {
  intent: NormalizedCommand['intent'];
  resultsExist: boolean;
  executorSummaryExists: boolean;
}): boolean {
  return input.intent === 'run-test-suite' && input.resultsExist && !input.executorSummaryExists;
}
