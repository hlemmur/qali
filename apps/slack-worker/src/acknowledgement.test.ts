import { describe, expect, it } from 'vitest';
import type { NormalizedCommand } from '@qali/contracts';
import {
  dispatchedWorkPhase,
  formatChannelAffinity,
  formatElapsed,
  formatWorkAcknowledgement,
  initialWorkPhase,
  WORK_PHASES
} from './acknowledgement.js';

const command = (overrides: Partial<NormalizedCommand> = {}): NormalizedCommand => ({
  intent: 'explore-project',
  project: {
    id: 'sauce-demo',
    root: 'projects/sauce-demo',
    environment: 'qali-sauce-demo',
    environmentLabel: 'production'
  },
  requestedBy: 'U1',
  externalRole: 'developer',
  receivedAt: '2026-08-13T21:00:00.000Z',
  parameters: { suite: 'smoke' },
  ...overrides
});

describe('channel affinity acknowledgement', () => {
  it('states the inferred project, environment, and suite', () => {
    expect(formatChannelAffinity(command())).toBe("I'll use `sauce-demo`, production, smoke.");
  });

  it('defaults the suite to smoke when the command does not name one', () => {
    expect(formatChannelAffinity(command({ parameters: {} }))).toBe(
      "I'll use `sauce-demo`, production, smoke."
    );
  });

  it('pairs affinity with a plain-language phase and elapsed time', () => {
    expect(formatWorkAcknowledgement(command(), WORK_PHASES.exploring, 8_000)).toBe(
      "I'll use `sauce-demo`, production, smoke.\nExploring the product (8s)"
    );
  });

  it('formats elapsed minutes without harness step IDs', () => {
    expect(formatElapsed(125_000)).toBe('2m 5s');
    expect(formatWorkAcknowledgement(command(), WORK_PHASES.checking)).not.toMatch(
      /step|workflow|github actions/i
    );
  });

  it('starts work by checking project, then uses an intent-specific activity', () => {
    expect(initialWorkPhase('explore-project')).toBe(WORK_PHASES.checking);
    expect(dispatchedWorkPhase('explore-project')).toBe(WORK_PHASES.exploring);
    expect(dispatchedWorkPhase('run-test-suite')).toBe(WORK_PHASES.running);
    expect(initialWorkPhase('query-project')).toBe(WORK_PHASES.lookingUp);
  });
});
