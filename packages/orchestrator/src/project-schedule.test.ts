import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectScheduleCrons,
  effectiveScheduleJobs,
  loadProjectSchedule,
  matchingScheduledJobs,
  parseProjectSchedule,
  renderProjectSchedule,
  scheduleAllowsIntent,
  scheduleTemplate,
  writeProjectSchedule
} from './project-schedule.js';

describe('project schedule', () => {
  it('seeds conservative and startup templates from the live pulse cron', () => {
    expect(scheduleTemplate('conservative').jobs).toEqual([
      { workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }
    ]);
    expect(scheduleTemplate('startup-e2e').jobs.map(({ workflowId }) => workflowId)).toEqual([
      'quality-pulse',
      'explore-project'
    ]);
  });

  it('disables every job while the project schedule is paused', () => {
    const paused = { ...scheduleTemplate('conservative'), paused: true };
    expect(effectiveScheduleJobs(paused).every((job) => job.enabled)).toBe(false);
    expect(scheduleAllowsIntent(paused, 'quality-pulse')).toBe(false);
    expect(matchingScheduledJobs(paused, '17 6 * * *')).toEqual([]);
  });

  it('round-trips a generated schedule file and reads the sauce-demo pack', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-schedule-'));
    writeProjectSchedule(workspace, scheduleTemplate('conservative'));
    const loaded = loadProjectSchedule(workspace);
    expect(loaded).toEqual(scheduleTemplate('conservative'));
    expect(
      parseProjectSchedule(
        readFileSync(join(workspace, 'derived/workflow-state/schedule.yaml'), 'utf8')
      )
    ).toEqual(loaded);
    expect(renderProjectSchedule(loaded)).toContain('qali:generated');

    const sauceDemo = loadProjectSchedule('projects/sauce-demo');
    expect(sauceDemo.template).toBe('conservative');
    expect(scheduleAllowsIntent(sauceDemo, 'quality-pulse')).toBe(true);
    expect(collectScheduleCrons([sauceDemo])).toEqual(['17 6 * * *']);
  });
});
