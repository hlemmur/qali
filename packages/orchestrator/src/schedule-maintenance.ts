import { join } from 'node:path';
import {
  IntentSchema,
  type NormalizedCommand,
  type ProjectSchedule,
  type WorkflowStep
} from '../../contracts/src/index.js';
import type { StepExecutionResult } from './execution.js';
import { loadProjectSchedule, writeProjectSchedule } from './project-schedule.js';

export function clockToDailyCron(text: string): string | undefined {
  const match = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\b/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (hour > 23 || minute > 59) return undefined;
  return `${minute} ${hour} * * *`;
}

export function applyScheduleAction(
  schedule: ProjectSchedule,
  parameters: Record<string, unknown>
): ProjectSchedule {
  const action = parameters.action;
  if (action === 'pause') return { ...schedule, paused: true };
  if (action === 'resume') return { ...schedule, paused: false };
  if (action === 'upsert-job') {
    const parsed = IntentSchema.safeParse(parameters.workflowId);
    const cron = typeof parameters.cron === 'string' ? parameters.cron.trim() : '';
    if (!parsed.success || !cron) {
      throw new Error('Schedule updates need workflowId and cron');
    }
    const jobs = [
      ...schedule.jobs.filter((job) => job.workflowId !== parsed.data),
      { workflowId: parsed.data, cron, enabled: true }
    ];
    return { ...schedule, paused: false, jobs };
  }
  throw new Error('Unsupported schedule action');
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
  return {
    status: 'succeeded',
    outputs: step.outputs.map(({ artifact, path }) => ({
      artifact,
      path: path.replaceAll('{projectId}', command.project.id)
    }))
  };
}
