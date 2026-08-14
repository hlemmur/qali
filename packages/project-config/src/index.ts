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
  browser: {
    name: ProjectExecutionProfile['browser']['name'];
    allowedSubmissions: Array<{ role: string; name: string }>;
  };
  redactionPatterns: string[];
  webServer?: { command: string; url: string };
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
    testData: jsonRecord(variables, names.testData),
    browser: {
      name: profile.browser.name,
      allowedSubmissions: profile.browser.allowedSubmissions ?? []
    },
    redactionPatterns: profile.redaction.patterns,
    ...(profile.webServer ? { webServer: profile.webServer } : {})
  };
}

function includesOrUnscoped(values: readonly string[], candidate: string): boolean {
  return values.length === 0 || values.includes(candidate);
}

function channelAuthorized(
  scope: { channelIds: readonly string[] },
  channelId: string,
  opsChannelIds: readonly string[]
): boolean {
  return scope.channelIds.includes(channelId) || opsChannelIds.includes(channelId);
}

function donorForOnboard(
  registry: ProjectRegistry,
  work: TrustedRequestContext,
  opsChannelIds: readonly string[]
) {
  return (
    registry.projects.find((project) =>
      channelAuthorized(project.allowedSlack, work.slack.channelId, opsChannelIds)
    ) ?? undefined
  );
}

function onboardProfile(projectId: string, reviewOnly: boolean): ProjectExecutionProfile {
  return ProjectExecutionProfileSchema.parse({
    version: 1,
    id: `${projectId}-production`,
    projectId,
    environmentLabel: 'production',
    targetVariables: {
      baseUrl: 'QALI_TARGET_BASE_URL',
      allowedOrigins: 'QALI_ALLOWED_ORIGINS_JSON',
      credentials: 'QALI_TEST_CREDENTIALS_JSON',
      testData: 'QALI_TEST_DATA_JSON'
    },
    browser: { name: 'chromium', allowDownloads: false, allowPopups: false },
    rate: { maxActionsPerMinute: 60 },
    mutation: { allowed: ['append-observation', 'append-evidence', 'render-derived-report'] },
    cleanup: { strategy: 'fixture-reset' },
    redaction: { patterns: [] },
    retention: { evidenceDays: 14 },
    publication: { reviewOnly }
  });
}

export function resolveTrustedCommand(
  untrustedClassification: unknown,
  work: TrustedRequestContext,
  registryInput: ProjectRegistry,
  profileInputs: readonly ProjectExecutionProfile[],
  options: { opsChannelIds?: readonly string[] } = {}
): NormalizedCommand {
  const classification = ClassifiedIntentSchema.parse(untrustedClassification);
  const registry = ProjectRegistrySchema.parse(registryInput);
  const opsChannelIds = options.opsChannelIds ?? [];
  const registered = registry.projects.find(
    (candidate) => candidate.id === classification.projectId
  );
  const donor =
    registered ??
    (classification.intent === 'onboard-project'
      ? donorForOnboard(registry, work, opsChannelIds)
      : undefined);
  if (!registered && classification.intent !== 'onboard-project') {
    throw new Error(`Unknown project: ${classification.projectId}`);
  }
  if (!donor) throw new Error(`Unknown project: ${classification.projectId}`);
  const project = registered ?? {
    ...donor,
    id: classification.projectId,
    root: `projects/${classification.projectId}`,
    githubEnvironment: `qali-${classification.projectId}`,
    activeExecutionProfile: `${classification.projectId}-production`
  };
  const scope = donor.allowedSlack;
  const authorized =
    includesOrUnscoped(scope.teamIds, work.slack.teamId) &&
    channelAuthorized(scope, work.slack.channelId, opsChannelIds) &&
    includesOrUnscoped(scope.userIds, work.requestedBy) &&
    scope.roles.includes(work.externalRole);
  if (!authorized) throw new Error(`Slack scope is not authorized for project ${project.id}`);
  if (!project.enabledWorkflows.includes(classification.intent)) {
    throw new Error(`Workflow ${classification.intent} is not enabled for project ${project.id}`);
  }
  const profiles = [
    ...profileInputs.map((profile) => ProjectExecutionProfileSchema.parse(profile)),
    ...(registered ? [] : [onboardProfile(project.id, project.publication.reviewOnly)])
  ];
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
