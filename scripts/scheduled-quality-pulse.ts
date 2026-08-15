import { readFileSync } from 'node:fs';
import {
  loadProjectSchedule,
  matchingScheduledJobs
} from '../packages/orchestrator/src/project-schedule.js';
import { buildScheduledCommand } from './scheduled-command.js';

const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8')) as {
  projects: Array<{ id: string; root: string }>;
};
const cron = process.env.GITHUB_EVENT_SCHEDULE?.trim();
if (!cron) throw new Error('GITHUB_EVENT_SCHEDULE is required for scheduled dispatch');
const scheduled = registry.projects[0];
if (!scheduled) throw new Error('No registered project is available for scheduled work');
const schedule = loadProjectSchedule(scheduled.root);
const job = matchingScheduledJobs(schedule, cron)[0];
if (!job) {
  throw new Error(`No enabled schedule job for cron ${cron} on ${scheduled.id}`);
}
const profile = JSON.parse(readFileSync(`${scheduled.root}/execution-profile.json`, 'utf8'));
const requestId = process.env.QALI_SCHEDULE_REQUEST_ID?.trim();
if (!requestId) throw new Error('QALI_SCHEDULE_REQUEST_ID is required');

process.stdout.write(
  JSON.stringify(
    buildScheduledCommand({
      registry,
      profiles: [profile],
      projectId: scheduled.id,
      intent: job.workflowId,
      receivedAt: new Date().toISOString(),
      requestId,
      schedule,
      ...(job.suite ? { suite: job.suite } : {})
    })
  )
);
