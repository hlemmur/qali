import { readFileSync } from 'node:fs';
import { buildScheduledCommand } from './scheduled-command.js';

const registry = JSON.parse(readFileSync('projects/registry.json', 'utf8'));
const profile = JSON.parse(readFileSync('projects/_demo/execution-profile.json', 'utf8'));
const requestId = process.env.QALI_SCHEDULE_REQUEST_ID?.trim();
if (!requestId) throw new Error('QALI_SCHEDULE_REQUEST_ID is required');

process.stdout.write(
  JSON.stringify(
    buildScheduledCommand({
      registry,
      profiles: [profile],
      projectId: '_demo',
      intent: 'quality-pulse',
      receivedAt: new Date().toISOString(),
      requestId
    })
  )
);
