import {
  ClassifiedIntentSchema,
  NormalizedCommandSchema,
  ProjectExecutionProfileSchema,
  ProjectRegistrySchema,
  type NormalizedCommand,
  type ProjectExecutionProfile,
  type ProjectRegistry
} from '@qali/contracts';

export interface TrustedRequestContext {
  requestedBy: string;
  externalRole: 'developer' | 'qa-lead-admin';
  receivedAt: string;
  slack: { teamId: string; channelId: string; threadTs: string; requestTs: string };
}

type EnvironmentVariables = Record<string, string | undefined>;

export interface ResolvedExecutionTarget {
  environmentLabel: ProjectExecutionProfile['environmentLabel'];
  baseUrl: string;
  allowedOrigins: string[];
  credentials: Record<string, unknown>;
  testData: Record<string, unknown>;
}

function requireVariable(variables: EnvironmentVariables, name: string): string {
  const value = variables[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function jsonRecord(variables: EnvironmentVariables, name: string): Record<string, unknown> {
  const value: unknown = JSON.parse(requireVariable(variables, name));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function safeOrigin(value: string, label: ProjectExecutionProfile['environmentLabel']): string {
  const url = new URL(value);
  const localHttp =
    url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !(label === 'mock' && localHttp)) {
    throw new Error(`Unsafe target origin ${url.origin}`);
  }
  if (url.username || url.password) throw new Error('Target URLs cannot contain credentials');
  return url.origin;
}

export function resolveExecutionTarget(
  input: ProjectExecutionProfile,
  variables: EnvironmentVariables
): ResolvedExecutionTarget {
  const profile = ProjectExecutionProfileSchema.parse(input);
  const names = profile.targetVariables;
  const baseUrl = requireVariable(variables, names.baseUrl);
  const baseOrigin = safeOrigin(baseUrl, profile.environmentLabel);
  const rawOrigins: unknown = JSON.parse(requireVariable(variables, names.allowedOrigins));
  if (!Array.isArray(rawOrigins) || rawOrigins.length === 0) {
    throw new Error(`${names.allowedOrigins} must be a non-empty JSON array`);
  }
  const allowedOrigins = rawOrigins.map((origin) => {
    if (typeof origin !== 'string') throw new Error(`${names.allowedOrigins} must contain URLs`);
    return safeOrigin(origin, profile.environmentLabel);
  });
  if (!allowedOrigins.includes(baseOrigin)) {
    throw new Error(`${names.baseUrl} origin is not in ${names.allowedOrigins}`);
  }
  return {
    environmentLabel: profile.environmentLabel,
    baseUrl,
    allowedOrigins: [...new Set(allowedOrigins)],
    credentials: jsonRecord(variables, names.credentials),
    testData: jsonRecord(variables, names.testData)
  };
}

function includesOrUnscoped(values: readonly string[], candidate: string): boolean {
  return values.length === 0 || values.includes(candidate);
}

export function resolveTrustedCommand(
  untrustedClassification: unknown,
  work: TrustedRequestContext,
  registryInput: ProjectRegistry,
  profileInputs: readonly ProjectExecutionProfile[]
): NormalizedCommand {
  const classification = ClassifiedIntentSchema.parse(untrustedClassification);
  const registry = ProjectRegistrySchema.parse(registryInput);
  const project = registry.projects.find((candidate) => candidate.id === classification.projectId);
  if (!project) throw new Error(`Unknown project: ${classification.projectId}`);
  const scope = project.allowedSlack;
  const authorized =
    includesOrUnscoped(scope.teamIds, work.slack.teamId) &&
    scope.channelIds.includes(work.slack.channelId) &&
    includesOrUnscoped(scope.userIds, work.requestedBy) &&
    scope.roles.includes(work.externalRole);
  if (!authorized) throw new Error(`Slack scope is not authorized for project ${project.id}`);
  if (!project.enabledWorkflows.includes(classification.intent)) {
    throw new Error(`Workflow ${classification.intent} is not enabled for project ${project.id}`);
  }
  const profiles = profileInputs.map((profile) => ProjectExecutionProfileSchema.parse(profile));
  const profile = profiles.find((candidate) => candidate.id === project.activeExecutionProfile);
  if (!profile) throw new Error(`Missing execution profile: ${project.activeExecutionProfile}`);
  if (profile.projectId !== project.id) {
    throw new Error(`Execution profile ${profile.id} does not belong to project ${project.id}`);
  }
  if (profile.publication.reviewOnly !== project.publication.reviewOnly) {
    throw new Error(`Execution profile ${profile.id} conflicts with publication policy`);
  }
  return NormalizedCommandSchema.parse({
    intent: classification.intent,
    project: {
      id: project.id,
      root: project.root,
      environment: project.githubEnvironment,
      environmentLabel: profile.environmentLabel,
      executionProfileId: profile.id,
      publication: project.publication,
      ...(profile.displayBadge ? { displayBadge: profile.displayBadge } : {})
    },
    requestedBy: work.requestedBy,
    externalRole: work.externalRole,
    receivedAt: work.receivedAt,
    parameters: classification.focus,
    slack: work.slack
  });
}
