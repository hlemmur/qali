import { z } from 'zod';

export const QALI_VERSION = '0.1.0';

export const INTENTS = [
  'onboard-project',
  'explore-project',
  'generate-test-suite',
  'run-test-suite',
  'triage-failure',
  'maintain-knowledge',
  'maintain-suite',
  'quality-pulse'
] as const;
export const IntentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof IntentSchema>;

export const ROLE_IDS = [
  'intake-planner',
  'knowledge-curator',
  'test-architect',
  'explorer',
  'test-generator',
  'executor',
  'failure-analyst',
  'suite-maintainer',
  'reporter'
] as const;
export const RoleIdSchema = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleIdSchema>;

export const ARTIFACT_CLASSES = [
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
] as const;
export const ArtifactClassSchema = z.enum(ARTIFACT_CLASSES);
export type ArtifactClass = z.infer<typeof ArtifactClassSchema>;

export const TOOL_IDS = [
  'file-read',
  'file-write',
  'browser',
  'playwright',
  'shell',
  'report-renderer'
] as const;
export const ToolIdSchema = z.enum(TOOL_IDS);
export type ToolId = z.infer<typeof ToolIdSchema>;

export const MUTATION_CLASSES = [
  'append-observation',
  'append-evidence',
  'render-derived-report',
  'format-document',
  'promote-to-confirmed',
  'change-expected-behavior',
  'update-visual-baseline',
  'file-external-ticket',
  'send-client-proposal',
  'delete-test',
  'skip-test',
  'weaken-assertion',
  'create-test',
  'modify-test'
] as const;
export const MutationClassSchema = z.enum(MUTATION_CLASSES);
export type MutationClass = z.infer<typeof MutationClassSchema>;

export const SlackCorrelationContextSchema = z
  .object({
    teamId: z.string().min(1),
    channelId: z.string().min(1),
    threadTs: z.string().min(1),
    requestTs: z.string().min(1)
  })
  .strict();
export type SlackCorrelationContext = z.infer<typeof SlackCorrelationContextSchema>;

export const ProjectMetadataSchema = z
  .object({
    id: z.string().regex(/^_?[a-z0-9][a-z0-9-]*$/),
    root: z.string().regex(/^projects\/_?[a-z0-9][a-z0-9-]*$/),
    environment: z.string().min(1).optional()
  })
  .strict();
export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;

export const AutonomyMetadataSchema = z
  .object({
    mode: z.enum(['conservative', 'balanced', 'autonomous']),
    approvalRefs: z.array(z.string().min(1)).default([]),
    allowProceedWithOpenQuestions: z.boolean().default(false)
  })
  .strict();
export type AutonomyMetadata = z.infer<typeof AutonomyMetadataSchema>;

export const FreeFormRequestSchema = z
  .object({
    text: z.string().trim().min(1),
    projectHint: z.string().trim().min(1).optional(),
    requestedBy: z.string().min(1),
    receivedAt: z.iso.datetime(),
    slack: SlackCorrelationContextSchema.optional()
  })
  .strict();
export type FreeFormRequest = z.infer<typeof FreeFormRequestSchema>;

export const NormalizedCommandSchema = z
  .object({
    intent: IntentSchema,
    project: ProjectMetadataSchema,
    requestedBy: z.string().min(1),
    receivedAt: z.iso.datetime(),
    parameters: z.record(z.string(), z.unknown()).default({}),
    autonomy: AutonomyMetadataSchema.optional(),
    slack: SlackCorrelationContextSchema.optional()
  })
  .strict();
export type NormalizedCommand = z.infer<typeof NormalizedCommandSchema>;

export const RolePermissionsSchema = z
  .object({
    readableArtifacts: z.array(ArtifactClassSchema),
    writableArtifacts: z.array(ArtifactClassSchema),
    tools: z.array(ToolIdSchema),
    mutations: z.array(MutationClassSchema)
  })
  .strict();

export const RoleProfileSchema = z
  .object({
    id: RoleIdSchema,
    displayName: z.string().min(1),
    permissions: RolePermissionsSchema
  })
  .strict();
export type RoleProfile = z.infer<typeof RoleProfileSchema>;

export const ArtifactReferenceSchema = z
  .object({
    artifact: ArtifactClassSchema,
    path: z.string().min(1)
  })
  .strict();
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

export const POLICY_GATES = [
  'execution',
  'approved-scenario',
  'human-approval',
  'knowledge-promotion'
] as const;
export const PolicyGateSchema = z.enum(POLICY_GATES);

export const PRECONDITIONS = [
  'project-exists',
  'project-context-present',
  'execution-unblocked',
  'approved-scenario-present',
  'test-suite-present',
  'failure-evidence-present'
] as const;
export const PreconditionSchema = z.enum(PRECONDITIONS);

export const WorkflowStepSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    role: RoleIdSchema,
    skill: z.string().regex(/^[a-z][a-z0-9-]*$/),
    needs: z.array(z.string()).default([]),
    inputs: z.array(ArtifactReferenceSchema),
    outputs: z.array(ArtifactReferenceSchema),
    requiredTools: z.array(ToolIdSchema),
    mutations: z.array(MutationClassSchema),
    policyGates: z.array(PolicyGateSchema),
    retries: z.number().int().min(0).max(5),
    timeoutMs: z.number().int().min(1000).max(3_600_000)
  })
  .strict();
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), intent: IntentSchema }).strict(),
  z
    .object({
      type: z.literal('event'),
      event: z.enum(['test-run-failed', 'knowledge-changed', 'suite-changed'])
    })
    .strict(),
  z.object({ type: z.literal('schedule'), cron: z.string().min(1) }).strict()
]);

export const WorkflowDescriptorSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string().min(1),
    description: z.string().min(1),
    executable: z.boolean(),
    triggers: z.array(WorkflowTriggerSchema).min(1),
    preconditions: z.array(PreconditionSchema),
    steps: z.array(WorkflowStepSchema).min(1)
  })
  .strict();
export type WorkflowDescriptor = z.infer<typeof WorkflowDescriptorSchema>;

export const WorkflowEventSchema = z
  .object({
    id: z.string().min(1),
    workflowId: z.string().min(1),
    runId: z.string().min(1),
    stepId: z.string().min(1).optional(),
    type: z.enum([
      'workflow-started',
      'step-started',
      'step-succeeded',
      'step-failed',
      'workflow-succeeded',
      'workflow-failed',
      'workflow-blocked'
    ]),
    occurredAt: z.iso.datetime(),
    detail: z.record(z.string(), z.unknown()).default({})
  })
  .strict();
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;

export const WorkflowStateSchema = z
  .object({
    workflowId: z.string().min(1),
    runId: z.string().min(1),
    status: z.enum(['pending', 'running', 'blocked', 'succeeded', 'failed']),
    currentStepId: z.string().min(1).optional(),
    completedStepIds: z.array(z.string()),
    project: ProjectMetadataSchema,
    autonomy: AutonomyMetadataSchema,
    slack: SlackCorrelationContextSchema.optional()
  })
  .strict();
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WorkflowResultSchema = z
  .object({
    workflowId: z.string().min(1),
    runId: z.string().min(1),
    status: z.enum(['blocked', 'succeeded', 'failed']),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    outputs: z.array(ArtifactReferenceSchema),
    events: z.array(WorkflowEventSchema)
  })
  .strict();
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;
