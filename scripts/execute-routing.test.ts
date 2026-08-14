import type { NormalizedCommand } from '../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { requiresQualifiedAgentRuntime, selectAgentExecutionRoute } from './execute-routing.js';

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

  it('uses deterministic triage artifacts around the host red-state gate in Mock Mode', () => {
    expect(selectAgentExecutionRoute(command('triage-failure'), true, true)).toBe(
      'deterministic-triage'
    );
  });

  it('uses deterministic knowledge proposals before host reconciliation in Mock Mode', () => {
    expect(selectAgentExecutionRoute(command('maintain-knowledge'), true, true)).toBe(
      'deterministic-knowledge-maintenance'
    );
  });

  it('uses deterministic guarded suite maintenance in Mock Mode', () => {
    expect(selectAgentExecutionRoute(command('maintain-suite'), true, true)).toBe(
      'deterministic-suite-maintenance'
    );
  });

  it('uses deterministic quality presentation even outside Mock Mode', () => {
    expect(selectAgentExecutionRoute(command('quality-pulse'), true, false)).toBe(
      'deterministic-quality-pulse'
    );
  });

  it('reads query-project snapshots on the host without Cursor or Playwright', () => {
    expect(selectAgentExecutionRoute(command('query-project'), true, false)).toBe(
      'deterministic-query-project'
    );
  });

  it('applies schedule pause and cron edits on the host without Cursor', () => {
    expect(selectAgentExecutionRoute(command('maintain-schedule'), true, false)).toBe(
      'deterministic-schedule-maintenance'
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

describe('unattended agent qualification gate', () => {
  it('lets host-deterministic intents run on a production profile without Cursor', () => {
    expect(requiresQualifiedAgentRuntime('quality-pulse', 'production')).toBe(false);
    expect(requiresQualifiedAgentRuntime('query-project', 'production')).toBe(false);
    expect(requiresQualifiedAgentRuntime('maintain-schedule', 'production')).toBe(false);
    expect(requiresQualifiedAgentRuntime('onboard-project', 'production')).toBe(false);
    expect(requiresQualifiedAgentRuntime('run-test-suite', 'production')).toBe(false);
  });

  it('still requires a qualified agent for explore and generate on production', () => {
    expect(requiresQualifiedAgentRuntime('explore-project', 'production')).toBe(true);
    expect(requiresQualifiedAgentRuntime('generate-test-suite', 'production')).toBe(true);
  });

  it('does not require a qualified agent in Mock Mode', () => {
    expect(requiresQualifiedAgentRuntime('explore-project', 'mock')).toBe(false);
  });
});
