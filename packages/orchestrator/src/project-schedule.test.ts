import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'prettier';
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
    expect(
      scheduleTemplate('conservative').jobs.map(({ workflowId, suite }) => ({ workflowId, suite }))
    ).toEqual([
      { workflowId: 'quality-pulse', suite: undefined },
      { workflowId: 'run-test-suite', suite: 'smoke' },
      { workflowId: 'run-test-suite', suite: 'regression' }
    ]);
    expect(scheduleTemplate('startup-e2e').jobs.map(({ workflowId }) => workflowId)).toEqual([
      'quality-pulse',
      'run-test-suite',
      'run-test-suite',
      'explore-project'
    ]);
  });

  it('disables every job while the project schedule is paused', () => {
    const paused = { ...scheduleTemplate('conservative'), paused: true };
    expect(effectiveScheduleJobs(paused).every((job) => job.enabled)).toBe(false);
    expect(scheduleAllowsIntent(paused, 'quality-pulse')).toBe(false);
    expect(matchingScheduledJobs(paused, '17 6 * * *')).toEqual([]);
  });

  it('round-trips a generated schedule file and reads the paused sauce-demo pack', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-schedule-'));
    writeProjectSchedule(workspace, scheduleTemplate('conservative'));
    const loaded = loadProjectSchedule(workspace);
    expect(loaded).toEqual(scheduleTemplate('conservative'));
    expect(
      parseProjectSchedule(
        readFileSync(join(workspace, 'derived/workflow-state/schedule.yaml'), 'utf8')
      )
    ).toEqual(loaded);
    const rendered = renderProjectSchedule(loaded);
    expect(rendered.startsWith('# qali:generated owner=qali sha256=')).toBe(true);
    expect(rendered).not.toContain('<!--');
    await expect(format(rendered, { parser: 'yaml' })).resolves.toEqual(expect.any(String));

    const sauceDemo = loadProjectSchedule('projects/sauce-demo');
    expect(sauceDemo.template).toBe('conservative');
    expect(sauceDemo.paused).toBe(true);
    expect(scheduleAllowsIntent(sauceDemo, 'quality-pulse')).toBe(false);
    expect(scheduleAllowsIntent(sauceDemo, 'run-test-suite')).toBe(false);
    expect(collectScheduleCrons([sauceDemo])).toEqual(['17 4 * * 0', '17 5 * * *', '17 6 * * *']);
  });
});
