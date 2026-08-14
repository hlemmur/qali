import {
  NormalizedCommandSchema,
  ProjectExecutionProfileSchema,
  ProjectRegistrySchema,
  type Intent,
  type NormalizedCommand,
  type ProjectSchedule
} from '../packages/contracts/src/index.js';
import {
  loadProjectSchedule,
  scheduleAllowsIntent
} from '../packages/orchestrator/src/project-schedule.js';

export function buildScheduledCommand(input: {
  registry: unknown;
  profiles: readonly unknown[];
  projectId: string;
  intent: Intent;
  receivedAt: string;
  requestId: string;
  schedule?: ProjectSchedule;
}): NormalizedCommand {
  const registry = ProjectRegistrySchema.parse(input.registry);
  const project = registry.projects.find(({ id }) => id === input.projectId);
  if (!project) throw new Error(`Unknown scheduled project: ${input.projectId}`);
  const schedule = input.schedule ?? loadProjectSchedule(project.root);
  if (!scheduleAllowsIntent(schedule, input.intent)) {
    throw new Error(`Project ${project.id} has no enabled schedule for ${input.intent}`);
  }
  if (!project.enabledWorkflows.includes(input.intent)) {
    throw new Error(`Workflow ${input.intent} is not enabled for project ${project.id}`);
  }
  const profiles = input.profiles.map((profile) => ProjectExecutionProfileSchema.parse(profile));
  const profile = profiles.find(({ id }) => id === project.activeExecutionProfile);
  if (!profile || profile.projectId !== project.id) {
    throw new Error(`Missing execution profile: ${project.activeExecutionProfile}`);
  }
  if (profile.publication.reviewOnly !== project.publication.reviewOnly) {
    throw new Error(`Execution profile ${profile.id} conflicts with publication policy`);
  }
  return NormalizedCommandSchema.parse({
    intent: input.intent,
    project: {
      id: project.id,
      root: project.root,
      environment: project.githubEnvironment,
      environmentLabel: profile.environmentLabel,
      executionProfileId: profile.id,
      publication: project.publication,
      ...(profile.displayBadge ? { displayBadge: profile.displayBadge } : {})
    },
    requestedBy: 'github-schedule',
    externalRole: 'qa-lead-admin',
    receivedAt: input.receivedAt,
    parameters: { requestId: input.requestId, trigger: 'schedule' }
  });
}
