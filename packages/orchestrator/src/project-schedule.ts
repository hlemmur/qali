import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  ProjectScheduleSchema,
  type Intent,
  type ProjectSchedule,
  type ScheduleJob
} from '../../contracts/src/index.js';
import { generatedDocumentBody, renderGeneratedDocument } from '../../knowledge/src/index.js';

export const PROJECT_SCHEDULE_RELATIVE_PATH = 'derived/workflow-state/schedule.yaml';

export function scheduleTemplate(template: ProjectSchedule['template']): ProjectSchedule {
  const pulse: ScheduleJob = {
    workflowId: 'quality-pulse',
    cron: '17 6 * * *',
    enabled: true
  };
  if (template === 'startup-e2e') {
    return {
      version: 1,
      template,
      paused: false,
      jobs: [pulse, { workflowId: 'explore-project', cron: '17 7 * * 1', enabled: true }]
    };
  }
  return { version: 1, template, paused: false, jobs: [pulse] };
}

export function effectiveScheduleJobs(schedule: ProjectSchedule): ScheduleJob[] {
  return schedule.jobs.map((job) => ({
    ...job,
    enabled: job.enabled && !schedule.paused
  }));
}

export function parseProjectSchedule(raw: string): ProjectSchedule {
  const body = generatedDocumentBody(raw) ?? raw;
  return ProjectScheduleSchema.parse(parseYaml(body));
}

export function renderProjectSchedule(schedule: ProjectSchedule): string {
  return renderGeneratedDocument(stringifyYaml(ProjectScheduleSchema.parse(schedule)));
}

export function loadProjectSchedule(projectRoot: string): ProjectSchedule {
  const path = join(projectRoot, PROJECT_SCHEDULE_RELATIVE_PATH);
  if (!existsSync(path)) {
    throw new Error(`Missing project schedule: ${PROJECT_SCHEDULE_RELATIVE_PATH}`);
  }
  return parseProjectSchedule(readFileSync(path, 'utf8'));
}

export function writeProjectSchedule(projectRoot: string, schedule: ProjectSchedule): void {
  const path = join(projectRoot, PROJECT_SCHEDULE_RELATIVE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderProjectSchedule(schedule));
}

export function collectScheduleCrons(schedules: readonly ProjectSchedule[]): string[] {
  return [...new Set(schedules.flatMap((schedule) => schedule.jobs.map((job) => job.cron)))].sort();
}

export function matchingScheduledJobs(schedule: ProjectSchedule, cron: string): ScheduleJob[] {
  return effectiveScheduleJobs(schedule).filter((job) => job.enabled && job.cron === cron);
}

export function scheduleAllowsIntent(schedule: ProjectSchedule, intent: Intent): boolean {
  return effectiveScheduleJobs(schedule).some((job) => job.enabled && job.workflowId === intent);
}
