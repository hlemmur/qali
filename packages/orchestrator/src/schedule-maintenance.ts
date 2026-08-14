import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SchedulableIntentSchema,
  isGithubActionsCron,
  type NormalizedCommand,
  type ProjectSchedule,
  type WorkflowStep
} from '../../contracts/src/index.js';
import type { StepExecutionResult } from './execution.js';
import {
  collectScheduleCrons,
  loadProjectSchedule,
  writeProjectSchedule
} from './project-schedule.js';

const EXECUTE_SCHEDULE_BLOCK = /^ {2}schedule:\n(?: {4}- cron: '[^'\n]+'\n)+/m;

export function clockToDailyCron(text: string): string | undefined {
  const match = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\b/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (hour > 23 || minute > 59) return undefined;
  return `${minute} ${hour} * * *`;
}

export function renderExecuteScheduleBlock(crons: readonly string[]): string {
  const unique = [...new Set(crons)].sort();
  if (unique.length === 0) {
    throw new Error('execute.yml needs at least one schedule cron');
  }
  return `  schedule:\n${unique.map((cron) => `    - cron: '${cron}'\n`).join('')}`;
}

export function patchExecuteWorkflowCrons(workflow: string, crons: readonly string[]): string {
  if (!EXECUTE_SCHEDULE_BLOCK.test(workflow)) {
    throw new Error('execute.yml is missing an on.schedule block');
  }
  return workflow.replace(EXECUTE_SCHEDULE_BLOCK, renderExecuteScheduleBlock(crons));
}

export function applyScheduleAction(
  schedule: ProjectSchedule,
  parameters: Record<string, unknown>
): ProjectSchedule {
  const action = parameters.action;
  if (action === 'pause') return { ...schedule, paused: true };
  if (action === 'resume') return { ...schedule, paused: false };
  if (action === 'upsert-job') {
    const parsed = SchedulableIntentSchema.safeParse(parameters.workflowId);
    const cron = typeof parameters.cron === 'string' ? parameters.cron.trim() : '';
    if (!parsed.success || !isGithubActionsCron(cron)) {
      throw new Error('Schedule updates need a schedulable workflowId and a 5-field cron');
    }
    const jobs = [
      ...schedule.jobs.filter((job) => job.workflowId !== parsed.data),
      { workflowId: parsed.data, cron, enabled: true }
    ];
    return { ...schedule, paused: false, jobs };
  }
  throw new Error('Unsupported schedule action');
}

export function syncScheduleLockstep(
  workspace: string,
  projectId: string,
  schedule: ProjectSchedule
): void {
  const registryPath = join(workspace, 'projects/registry.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    projects: Array<{ id: string; root: string; schedules: ProjectSchedule['jobs'] }>;
  };
  const project = registry.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error(`Registry has no project ${projectId}`);
  }
  project.schedules = schedule.jobs;
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  const schedules = registry.projects.map((entry) =>
    entry.id === projectId ? schedule : loadProjectSchedule(join(workspace, entry.root))
  );
  const workflowPath = join(workspace, '.github/workflows/execute.yml');
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(
    workflowPath,
    patchExecuteWorkflowCrons(readFileSync(workflowPath, 'utf8'), collectScheduleCrons(schedules))
  );
}

export async function executeScheduleMaintenanceStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  if (command.intent !== 'maintain-schedule' || step.id !== 'apply') {
    return { status: 'blocked', reason: 'unsupported deterministic schedule-maintenance step' };
  }
  const projectRoot = join(workspace, command.project.root);
  const next = applyScheduleAction(loadProjectSchedule(projectRoot), command.parameters);
  writeProjectSchedule(projectRoot, next);
  if (command.parameters.action === 'upsert-job') {
    syncScheduleLockstep(workspace, command.project.id, next);
  }
  return {
    status: 'succeeded',
    outputs: step.outputs.map(({ artifact, path }) => ({
      artifact,
      path: path.replaceAll('{projectId}', command.project.id)
    }))
  };
}
