import type { NormalizedCommand } from '@qali/contracts';
import { describe, expect, it } from 'vitest';
import { authorizeCommand, externalRoleForUser, isPrivilegedAction } from './authorization.js';

const command = (
  intent: NormalizedCommand['intent'],
  overrides: Partial<NormalizedCommand> = {}
): NormalizedCommand => ({
  intent,
  project: { id: 'demo', root: 'projects/demo' },
  requestedBy: 'U_DEV',
  externalRole: 'developer',
  receivedAt: '2026-08-10T20:00:00.000Z',
  parameters: {},
  ...overrides
});

describe('external role authorization', () => {
  it('maps configured QA Leads and defaults every other allowed user to Developer', () => {
    expect(externalRoleForUser('U_LEAD', 'U_LEAD,U_ADMIN')).toBe('qa-lead-admin');
    expect(externalRoleForUser('U_DEV', 'U_LEAD,U_ADMIN')).toBe('developer');
    expect(externalRoleForUser('U_DEV')).toBe('developer');
  });

  it.each([
    'explore-project',
    'generate-test-suite',
    'run-test-suite',
    'triage-failure',
    'quality-pulse',
    'query-project'
  ] as const)('allows a Developer to request %s', (intent) => {
    expect(authorizeCommand(command(intent))).toEqual({ allowed: true });
  });

  it('rejects Developer maintenance and governance changes before dispatch', () => {
    expect(authorizeCommand(command('maintain-suite'))).toMatchObject({ allowed: false });
    expect(authorizeCommand(command('maintain-knowledge'))).toMatchObject({ allowed: false });
    expect(
      authorizeCommand(
        command('run-test-suite', {
          autonomy: {
            mode: 'autonomous',
            approvalRefs: [],
            allowProceedWithOpenQuestions: false
          }
        })
      )
    ).toMatchObject({ allowed: false });
    expect(
      authorizeCommand(command('quality-pulse', { parameters: { authority: 'override' } }))
    ).toMatchObject({ allowed: false });
  });

  it('allows a QA Lead/Admin to request maintenance and policy workflows', () => {
    expect(
      authorizeCommand(
        command('maintain-suite', {
          externalRole: 'qa-lead-admin',
          parameters: { policyRef: 'D-12' }
        })
      )
    ).toEqual({ allowed: true });
  });

  it('identifies policy-affecting Slack actions for rejection before queueing', () => {
    expect(isPrivilegedAction('change_autonomy')).toBe(true);
    expect(isPrivilegedAction('approve_policy')).toBe(true);
    expect(isPrivilegedAction('rerun_workflow')).toBe(false);
  });
});
