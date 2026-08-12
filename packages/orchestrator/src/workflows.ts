import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NormalizedCommandSchema,
  RoleProfileSchema,
  WorkflowDescriptorSchema,
  type ArtifactClass,
  type NormalizedCommand,
  type RoleId,
  type RoleProfile,
  type WorkflowDescriptor
} from '../../contracts/src/index.js';
import { parse as parseYaml } from 'yaml';

const role = (profile: RoleProfile): RoleProfile => RoleProfileSchema.parse(profile);

export const ROLE_PROFILES: Record<RoleId, RoleProfile> = {
  'intake-planner': role({
    id: 'intake-planner',
    displayName: 'Intake Planner',
    permissions: {
      readableArtifacts: ['project-context', 'reference', 'questions', 'decisions'],
      writableArtifacts: ['questions', 'tasks', 'jobs', 'workflow-state'],
      tools: ['file-read', 'file-write'],
      mutations: ['append-observation', 'format-document']
    }
  }),
  'knowledge-curator': role({
    id: 'knowledge-curator',
    displayName: 'Knowledge Curator',
    permissions: {
      readableArtifacts: [
        'project-context',
        'reference',
        'questions',
        'decisions',
        'known-issues',
        'evidence'
      ],
      writableArtifacts: ['project-context', 'reference', 'questions', 'known-issues'],
      tools: ['file-read', 'file-write'],
      mutations: [
        'append-observation',
        'append-evidence',
        'format-document',
        'promote-to-confirmed'
      ]
    }
  }),
  'test-architect': role({
    id: 'test-architect',
    displayName: 'Test Architect',
    permissions: {
      readableArtifacts: [
        'project-context',
        'reference',
        'questions',
        'decisions',
        'scenarios',
        'evidence'
      ],
      writableArtifacts: ['scenarios', 'reports', 'questions'],
      tools: ['file-read', 'file-write', 'report-renderer'],
      mutations: ['append-observation', 'render-derived-report', 'format-document']
    }
  }),
  explorer: role({
    id: 'explorer',
    displayName: 'Explorer',
    permissions: {
      readableArtifacts: ['project-context', 'reference', 'scenarios', 'known-issues'],
      writableArtifacts: ['evidence', 'exploration', 'reference', 'questions', 'known-issues'],
      tools: ['file-read', 'file-write', 'browser'],
      mutations: ['append-observation', 'append-evidence']
    }
  }),
  'test-generator': role({
    id: 'test-generator',
    displayName: 'Test Generator',
    permissions: {
      readableArtifacts: ['project-context', 'reference', 'decisions', 'scenarios'],
      writableArtifacts: ['tests', 'evidence'],
      tools: ['file-read', 'file-write', 'shell', 'playwright'],
      mutations: ['create-test', 'append-evidence']
    }
  }),
  executor: role({
    id: 'executor',
    displayName: 'Executor',
    permissions: {
      readableArtifacts: ['project-context', 'reference', 'scenarios', 'tests'],
      writableArtifacts: ['evidence', 'reports', 'jobs'],
      tools: ['file-read', 'file-write', 'shell', 'playwright', 'report-renderer'],
      mutations: ['append-evidence', 'render-derived-report']
    }
  }),
  'failure-analyst': role({
    id: 'failure-analyst',
    displayName: 'Failure Analyst',
    permissions: {
      readableArtifacts: ['project-context', 'reference', 'tests', 'evidence', 'known-issues'],
      writableArtifacts: ['evidence', 'known-issues', 'reports', 'questions'],
      tools: ['file-read', 'file-write', 'shell', 'playwright', 'report-renderer'],
      mutations: ['append-observation', 'append-evidence', 'render-derived-report']
    }
  }),
  'suite-maintainer': role({
    id: 'suite-maintainer',
    displayName: 'Suite Maintainer',
    permissions: {
      readableArtifacts: [
        'project-context',
        'reference',
        'decisions',
        'scenarios',
        'tests',
        'evidence',
        'reports'
      ],
      writableArtifacts: ['tests', 'evidence', 'reports'],
      tools: ['file-read', 'file-write', 'shell', 'playwright', 'report-renderer'],
      mutations: [
        'modify-test',
        'delete-test',
        'skip-test',
        'update-visual-baseline',
        'append-evidence',
        'render-derived-report'
      ]
    }
  }),
  reporter: role({
    id: 'reporter',
    displayName: 'Reporter',
    permissions: {
      readableArtifacts: [
        'project-context',
        'reference',
        'questions',
        'decisions',
        'known-issues',
        'exploration',
        'scenarios',
        'tests',
        'evidence',
        'reports',
        'tasks',
        'jobs',
        'workflow-state'
      ],
      writableArtifacts: ['reports'],
      tools: ['file-read', 'file-write', 'report-renderer'],
      mutations: ['render-derived-report', 'format-document']
    }
  })
};

const ARTIFACT_PATHS: Record<ArtifactClass, RegExp> = {
  'project-context': /^projects\/\{projectId\}\/sources\/project-context\.md$/,
  reference: /^projects\/\{projectId\}\/sources\/reference(?:\/|$)/,
  questions: /^projects\/\{projectId\}\/sources\/questions\.md$/,
  decisions: /^projects\/\{projectId\}\/sources\/decisions\.md$/,
  'known-issues': /^projects\/\{projectId\}\/observations\/known-issues\.md$/,
  exploration: /^projects\/\{projectId\}\/observations\/exploration\.md$/,
  scenarios: /^projects\/\{projectId\}\/derived\/scenarios(?:\/|$)/,
  tests: /^projects\/\{projectId\}\/tests(?:\/|$)/,
  evidence: /^projects\/\{projectId\}\/observations\/evidence(?:\/|$)/,
  reports: /^projects\/\{projectId\}\/derived\/reports(?:\/|$)/,
  tasks: /^projects\/\{projectId\}\/derived\/tasks(?:\/|$)/,
  jobs: /^projects\/\{projectId\}\/derived\/jobs(?:\/|$)/,
  'workflow-state': /^projects\/\{projectId\}\/derived\/workflow-state(?:\/|$)/
};

const APPROVAL_MUTATIONS = new Set([
  'promote-to-confirmed',
  'change-expected-behavior',
  'update-visual-baseline',
  'file-external-ticket',
  'send-client-proposal',
  'delete-test',
  'skip-test'
]);

export interface WorkflowValidationContext {
  harnessProfileIds: ReadonlySet<string>;
  roles?: Readonly<Record<string, RoleProfile>>;
}

function requireSubset(
  values: readonly string[],
  allowed: readonly string[],
  label: string,
  stepId: string
): void {
  const denied = values.filter((value) => !allowed.includes(value));
  if (denied.length > 0) {
    throw new Error(`step "${stepId}" exceeds role permission for ${label}: ${denied.join(', ')}`);
  }
}

export function validateWorkflow(
  input: unknown,
  context: WorkflowValidationContext
): WorkflowDescriptor {
  const workflow = WorkflowDescriptorSchema.parse(input);
  const roles = context.roles ?? ROLE_PROFILES;
  const seen = new Set<string>();

  for (const step of workflow.steps) {
    if (seen.has(step.id)) {
      throw new Error(`duplicate workflow step: ${step.id}`);
    }
    for (const dependency of step.needs) {
      if (!seen.has(dependency)) {
        throw new Error(`step "${step.id}" needs unknown or later step "${dependency}"`);
      }
    }
    seen.add(step.id);

    const profile = roles[step.role];
    if (!profile) {
      throw new Error(`unknown role reference: ${step.role}`);
    }
    if (!context.harnessProfileIds.has(step.harnessProfileId)) {
      throw new Error(`unknown harness profile reference: ${step.harnessProfileId}`);
    }

    requireSubset(
      step.inputs.map(({ artifact }) => artifact),
      profile.permissions.readableArtifacts,
      'readable artifacts',
      step.id
    );
    requireSubset(
      step.outputs.map(({ artifact }) => artifact),
      profile.permissions.writableArtifacts,
      'writable artifacts',
      step.id
    );
    requireSubset(step.requiredTools, profile.permissions.tools, 'tools', step.id);
    requireSubset(step.mutations, profile.permissions.mutations, 'mutations', step.id);

    for (const reference of [...step.inputs, ...step.outputs]) {
      if (
        reference.path.startsWith('/') ||
        reference.path.includes('..') ||
        !ARTIFACT_PATHS[reference.artifact].test(reference.path)
      ) {
        throw new Error(
          `step "${step.id}" has invalid path for ${reference.artifact}: ${reference.path}`
        );
      }
    }
    if (step.mutations.includes('weaken-assertion')) {
      throw new Error(`step "${step.id}" requests prohibited mutation weaken-assertion`);
    }
    if (
      step.mutations.some((mutation) => APPROVAL_MUTATIONS.has(mutation)) &&
      !step.policyGates.includes('human-approval')
    ) {
      throw new Error(`step "${step.id}" requires the human-approval policy gate`);
    }
    if (
      step.mutations.includes('promote-to-confirmed') &&
      !step.policyGates.includes('knowledge-promotion')
    ) {
      throw new Error(`step "${step.id}" requires the knowledge-promotion policy gate`);
    }
    if (
      step.mutations.some((mutation) => mutation === 'create-test' || mutation === 'modify-test') &&
      (!step.policyGates.includes('execution') || !step.policyGates.includes('approved-scenario'))
    ) {
      throw new Error(`step "${step.id}" requires execution and approved-scenario policy gates`);
    }
  }

  return workflow;
}

const localPath = (path: URL | string): string =>
  path instanceof URL ? fileURLToPath(path) : path;

export function loadWorkflowDirectory(
  directory: URL | string,
  harnessProfileCatalog: URL | string
): WorkflowDescriptor[] {
  const catalog = JSON.parse(readFileSync(localPath(harnessProfileCatalog), 'utf8')) as {
    profiles?: Array<{ id?: unknown }>;
  };
  const harnessProfileIds = new Set(
    (catalog.profiles ?? []).flatMap(({ id }) => (typeof id === 'string' ? [id] : []))
  );
  const directoryName = localPath(directory);

  return readdirSync(directoryName)
    .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
    .sort()
    .map((file) =>
      validateWorkflow(parseYaml(readFileSync(`${directoryName}/${file}`, 'utf8')), {
        harnessProfileIds
      })
    );
}

export function routeCommand(
  input: NormalizedCommand,
  workflows: readonly WorkflowDescriptor[]
): WorkflowDescriptor {
  const command = NormalizedCommandSchema.parse(input);
  const matches = workflows.filter((workflow) =>
    workflow.triggers.some(
      (trigger) => trigger.type === 'command' && trigger.intent === command.intent
    )
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `no workflow route for intent: ${command.intent}`
        : `ambiguous workflow route for intent: ${command.intent}`
    );
  }
  return matches[0]!;
}
