import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildScheduledCommand } from './scheduled-command.js';

describe('scheduled command', () => {
  it('resolves the enabled quality pulse through trusted project metadata', () => {
    const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8'));
    const profile = JSON.parse(readFileSync('projects/_demo/execution-profile.json', 'utf8'));

    expect(
      buildScheduledCommand({
        registry,
        profiles: [profile],
        projectId: '_demo',
        intent: 'quality-pulse',
        receivedAt: '2026-08-13T10:00:00.000Z',
        requestId: 'scheduled-123'
      })
    ).toMatchObject({
      intent: 'quality-pulse',
      project: {
        id: '_demo',
        root: 'projects/_demo',
        environment: 'qali-demo',
        environmentLabel: 'mock',
        executionProfileId: 'demo-mock'
      },
      requestedBy: 'github-schedule',
      externalRole: 'qa-lead-admin',
      parameters: { requestId: 'scheduled-123', trigger: 'schedule' }
    });
  });

  it('rejects a workflow without an enabled project schedule', () => {
    const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8'));
    const profile = JSON.parse(readFileSync('projects/_demo/execution-profile.json', 'utf8'));

    expect(() =>
      buildScheduledCommand({
        registry,
        profiles: [profile],
        projectId: '_demo',
        intent: 'run-test-suite',
        receivedAt: '2026-08-13T10:00:00.000Z',
        requestId: 'scheduled-123'
      })
    ).toThrow(/enabled schedule/i);
  });
});
