import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildScheduledCommand } from './scheduled-command.js';

describe('scheduled command', () => {
  it('resolves the enabled quality pulse through trusted project metadata', () => {
    const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8'));
    const profile = JSON.parse(readFileSync('projects/sauce-demo/execution-profile.json', 'utf8'));

    expect(
      buildScheduledCommand({
        registry,
        profiles: [profile],
        projectId: 'sauce-demo',
        intent: 'quality-pulse',
        receivedAt: '2026-08-13T10:00:00.000Z',
        requestId: 'scheduled-123'
      })
    ).toMatchObject({
      intent: 'quality-pulse',
      project: {
        id: 'sauce-demo',
        root: 'projects/sauce-demo',
        environment: 'qali-sauce-demo',
        environmentLabel: 'production',
        executionProfileId: 'sauce-demo-production'
      },
      requestedBy: 'github-schedule',
      externalRole: 'qa-lead-admin',
      parameters: { requestId: 'scheduled-123', trigger: 'schedule' }
    });
  });

  it('rejects a workflow without an enabled project schedule', () => {
    const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8'));
    const profile = JSON.parse(readFileSync('projects/sauce-demo/execution-profile.json', 'utf8'));

    expect(() =>
      buildScheduledCommand({
        registry,
        profiles: [profile],
        projectId: 'sauce-demo',
        intent: 'run-test-suite',
        receivedAt: '2026-08-13T10:00:00.000Z',
        requestId: 'scheduled-123',
        schedule: {
          version: 1,
          template: 'conservative',
          paused: false,
          jobs: [{ workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }]
        }
      })
    ).toThrow(/enabled schedule/i);
  });

  it('schedules smoke runs with the suite parameter from the job', () => {
    const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8'));
    const profile = JSON.parse(readFileSync('projects/sauce-demo/execution-profile.json', 'utf8'));

    expect(
      buildScheduledCommand({
        registry,
        profiles: [profile],
        projectId: 'sauce-demo',
        intent: 'run-test-suite',
        receivedAt: '2026-08-13T10:00:00.000Z',
        requestId: 'scheduled-smoke',
        schedule: {
          version: 1,
          template: 'conservative',
          paused: false,
          jobs: [
            {
              workflowId: 'run-test-suite',
              cron: '17 5 * * *',
              enabled: true,
              suite: 'smoke'
            }
          ]
        },
        suite: 'smoke'
      })
    ).toMatchObject({
      intent: 'run-test-suite',
      parameters: { requestId: 'scheduled-smoke', trigger: 'schedule', suite: 'smoke' }
    });
  });

  it('rejects scheduled work when the project schedule is paused', () => {
    const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8'));
    const profile = JSON.parse(readFileSync('projects/sauce-demo/execution-profile.json', 'utf8'));

    expect(() =>
      buildScheduledCommand({
        registry,
        profiles: [profile],
        projectId: 'sauce-demo',
        intent: 'quality-pulse',
        receivedAt: '2026-08-13T10:00:00.000Z',
        requestId: 'scheduled-123',
        schedule: {
          version: 1,
          template: 'conservative',
          paused: true,
          jobs: [{ workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }]
        }
      })
    ).toThrow(/enabled schedule/i);
  });
});
