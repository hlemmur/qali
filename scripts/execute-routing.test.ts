import type { NormalizedCommand } from '../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { selectAgentExecutionRoute } from './execute-routing.js';

const command = (intent: NormalizedCommand['intent']): NormalizedCommand => ({
  intent,
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: {}
});

describe('agent execution routing', () => {
  it('keeps onboarding deterministic when the Cursor CLI is available', () => {
    expect(selectAgentExecutionRoute(command('onboard-project'), true, true)).toBe(
      'deterministic-onboarding'
    );
  });

  it('uses the restricted deterministic explorer in Mock Mode when the Cursor CLI is available', () => {
    expect(selectAgentExecutionRoute(command('explore-project'), true, true)).toBe(
      'deterministic-exploration'
    );
  });

  it('uses deterministic test generation and validation in Mock Mode', () => {
    expect(selectAgentExecutionRoute(command('generate-test-suite'), true, true)).toBe(
      'deterministic-test-generation'
    );
  });

  it('uses the Cursor runtime for other agent steps when it is available', () => {
    expect(selectAgentExecutionRoute(command('explore-project'), true, false)).toBe('cursor');
  });

  it('uses the deterministic fallback when the Cursor CLI is unavailable', () => {
    expect(selectAgentExecutionRoute(command('explore-project'), false, false)).toBe(
      'deterministic-fallback'
    );
  });
});
