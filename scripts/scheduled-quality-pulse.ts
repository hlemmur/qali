import { readFileSync } from 'node:fs';
import { buildScheduledCommand } from './scheduled-command.js';

const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8')) as {
  projects: Array<{ id: string; root: string; schedules: Array<{ workflowId: string }> }>;
};
const scheduled =
  registry.projects.find((project) =>
    project.schedules.some((entry) => entry.workflowId === 'quality-pulse')
  ) ?? registry.projects[0];
if (!scheduled) throw new Error('No registered project is available for scheduled quality pulse');
const profile = JSON.parse(readFileSync(`${scheduled.root}/execution-profile.json`, 'utf8'));
const requestId = process.env.QALI_SCHEDULE_REQUEST_ID?.trim();
if (!requestId) throw new Error('QALI_SCHEDULE_REQUEST_ID is required');

process.stdout.write(
  JSON.stringify(
    buildScheduledCommand({
      registry,
      profiles: [profile],
      projectId: scheduled.id,
      intent: 'quality-pulse',
      receivedAt: new Date().toISOString(),
      requestId
    })
  )
);
