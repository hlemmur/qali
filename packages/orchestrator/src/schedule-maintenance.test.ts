import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import {
  applyScheduleAction,
  clockToDailyCron,
  executeScheduleMaintenanceStep
} from './schedule-maintenance.js';
import { loadProjectSchedule, scheduleTemplate, writeProjectSchedule } from './project-schedule.js';

const command: NormalizedCommand = {
  intent: 'maintain-schedule',
  project: { id: 'shop', root: 'projects/shop' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-14T12:00:00.000Z',
  parameters: { action: 'pause' }
};

const applyStep = {
  id: 'apply',
  outputs: [
    {
      artifact: 'workflow-state',
      path: 'projects/{projectId}/derived/workflow-state/schedule.yaml'
    }
  ]
} as WorkflowStep;

describe('schedule maintenance', () => {
  it('maps a wall-clock time to a daily UTC cron', () => {
    expect(clockToDailyCron('schedule full regression for 04:00')).toBe('0 4 * * *');
    expect(clockToDailyCron('at 9')).toBe('0 9 * * *');
  });

  it('pauses, resumes, and upserts jobs on the project schedule file', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-maintain-schedule-'));
    const projectRoot = join(workspace, 'projects/shop');
    writeProjectSchedule(projectRoot, scheduleTemplate('conservative'));

    await expect(
      executeScheduleMaintenanceStep(workspace, applyStep, command)
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(loadProjectSchedule(projectRoot).paused).toBe(true);

    await executeScheduleMaintenanceStep(workspace, applyStep, {
      ...command,
      parameters: { action: 'resume' }
    });
    expect(loadProjectSchedule(projectRoot).paused).toBe(false);

    await executeScheduleMaintenanceStep(workspace, applyStep, {
      ...command,
      parameters: { action: 'upsert-job', workflowId: 'run-test-suite', cron: '0 4 * * *' }
    });
    expect(loadProjectSchedule(projectRoot).jobs).toEqual(
      expect.arrayContaining([
        { workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true },
        { workflowId: 'run-test-suite', cron: '0 4 * * *', enabled: true }
      ])
    );
  });

  it('rejects an unknown schedule action', () => {
    expect(() =>
      applyScheduleAction(scheduleTemplate('conservative'), { action: 'delete-everything' })
    ).toThrow(/unsupported schedule action/i);
  });
});
