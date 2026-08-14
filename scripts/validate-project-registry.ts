import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  ProjectExecutionProfileSchema,
  ProjectRegistrySchema,
  type ProjectSchedule
} from '../packages/contracts/src/index.js';
import { parse as parseYaml } from 'yaml';
import {
  collectScheduleCrons,
  loadProjectSchedule
} from '../packages/orchestrator/src/project-schedule.js';

const workspace = process.cwd();
const registryPath = join(workspace, 'projects/registry.json');
const registry = ProjectRegistrySchema.parse(JSON.parse(readFileSync(registryPath, 'utf8')));
const schedules: ProjectSchedule[] = [];

for (const project of registry.projects) {
  const root = join(workspace, project.root);
  if (!existsSync(root)) throw new Error(`Registered project root does not exist: ${project.root}`);
  const profilePath = join(root, 'execution-profile.json');
  if (!existsSync(profilePath)) {
    throw new Error(`Missing execution profile for ${project.id}: ${profilePath}`);
  }
  const profile = ProjectExecutionProfileSchema.parse(
    JSON.parse(readFileSync(profilePath, 'utf8'))
  );
  if (profile.id !== project.activeExecutionProfile) {
    throw new Error(
      `Active profile mismatch for ${project.id}: registry=${project.activeExecutionProfile}, file=${profile.id}`
    );
  }
  if (profile.projectId !== project.id) {
    throw new Error(`Execution profile ${profile.id} does not belong to ${project.id}`);
  }
  if (profile.publication.reviewOnly !== project.publication.reviewOnly) {
    throw new Error(`Publication policy mismatch for ${project.id}`);
  }
  const schedule = loadProjectSchedule(root);
  schedules.push(schedule);
  const expectedJobs = schedule.jobs;
  const registryJobs = project.schedules.map((entry) => ({
    workflowId: entry.workflowId,
    cron: entry.cron,
    enabled: entry.enabled
  }));
  if (JSON.stringify(expectedJobs) !== JSON.stringify(registryJobs)) {
    throw new Error(
      `Registry schedules for ${project.id} do not match ${project.root}/derived/workflow-state/schedule.yaml`
    );
  }
}

const workflow = parseYaml(
  readFileSync(join(workspace, '.github/workflows/execute.yml'), 'utf8')
) as { on?: { schedule?: Array<{ cron?: string }> } };
const executeCrons = [
  ...new Set(
    (workflow.on?.schedule ?? [])
      .map((entry) => entry.cron)
      .filter((cron): cron is string => typeof cron === 'string')
  )
].sort();
const expectedCrons = collectScheduleCrons(schedules);
if (JSON.stringify(executeCrons) !== JSON.stringify(expectedCrons)) {
  throw new Error(
    `execute.yml crons ${JSON.stringify(executeCrons)} do not match project schedules ${JSON.stringify(expectedCrons)}`
  );
}

console.log(
  JSON.stringify({
    valid: true,
    registryVersion: registry.version,
    projects: registry.projects.length,
    crons: expectedCrons
  })
);
