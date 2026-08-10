import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  NormalizedCommandSchema,
  WorkflowDescriptorSchema,
  WorkflowResultSchema,
  type ArtifactReference,
  type NormalizedCommand,
  type WorkflowDescriptor,
  type WorkflowEvent,
  type WorkflowResult,
  type WorkflowStep
} from '../../contracts/src/index.js';

type Precondition = WorkflowDescriptor['preconditions'][number];

export interface WorkflowLoader {
  load(command: NormalizedCommand): Promise<WorkflowDescriptor> | WorkflowDescriptor;
}

export interface PreconditionChecker {
  check(
    precondition: Precondition,
    command: NormalizedCommand
  ): Promise<{ allowed: true } | { allowed: false; reason: string }>;
}

export interface PolicyEnforcer {
  authorize(
    step: WorkflowStep,
    command: NormalizedCommand
  ): Promise<{ allowed: true } | { allowed: false; reason: string }>;
}

export type StepExecutionResult =
  | { status: 'succeeded'; outputs: ArtifactReference[] }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; error: string };

export interface StepExecutor {
  execute(step: WorkflowStep, command: NormalizedCommand): Promise<StepExecutionResult>;
}

export interface WorkflowEventStore {
  append(event: WorkflowEvent): Promise<void>;
}

export interface OutputValidator {
  validate(
    step: WorkflowStep,
    outputs: readonly ArtifactReference[],
    command: NormalizedCommand
  ): Promise<{ valid: true } | { valid: false; reason: string }>;
}

export interface WorkflowExecutionPorts {
  loader: WorkflowLoader;
  preconditions: PreconditionChecker;
  policy: PolicyEnforcer;
  executor: StepExecutor;
  events: WorkflowEventStore;
  outputValidator: OutputValidator;
  now?: () => Date;
  id?: () => string;
}

const expandOutputPath = (path: string, command: NormalizedCommand): string =>
  path.replaceAll('{projectId}', command.project.id);

export class FileSystemOutputValidator implements OutputValidator {
  constructor(private readonly workspace: string) {}

  async validate(
    step: WorkflowStep,
    outputs: readonly ArtifactReference[],
    command: NormalizedCommand
  ): Promise<{ valid: true } | { valid: false; reason: string }> {
    const expected = new Set(
      step.outputs.map(({ artifact, path }) => `${artifact}:${expandOutputPath(path, command)}`)
    );
    const actual = new Set(outputs.map(({ artifact, path }) => `${artifact}:${path}`));
    if (expected.size !== actual.size || [...expected].some((value) => !actual.has(value))) {
      return { valid: false, reason: `step ${step.id} returned undeclared or missing outputs` };
    }

    const workspaceRoot = resolve(this.workspace);
    for (const { path } of outputs) {
      const outputPath = resolve(workspaceRoot, path);
      if (outputPath !== workspaceRoot && !outputPath.startsWith(`${workspaceRoot}${sep}`)) {
        return {
          valid: false,
          reason: `step ${step.id} returned output outside workspace: ${path}`
        };
      }
      if (!existsSync(outputPath)) {
        return { valid: false, reason: `step ${step.id} did not materialize output: ${path}` };
      }
      if (statSync(outputPath).isDirectory() && readdirSync(outputPath).length === 0) {
        return { valid: false, reason: `step ${step.id} materialized an empty output: ${path}` };
      }
    }
    return { valid: true };
  }
}

export async function executeWorkflow(
  input: NormalizedCommand,
  ports: WorkflowExecutionPorts
): Promise<WorkflowResult> {
  const command = NormalizedCommandSchema.parse(input);
  const workflow = WorkflowDescriptorSchema.parse(await ports.loader.load(command));
  const now = ports.now ?? (() => new Date());
  const id = ports.id ?? (() => crypto.randomUUID());
  const runId = id();
  const startedAt = now().toISOString();
  const events: WorkflowEvent[] = [];
  const outputs: ArtifactReference[] = [];

  const emit = async (
    type: WorkflowEvent['type'],
    detail: Record<string, unknown> = {},
    stepId?: string
  ): Promise<void> => {
    const event: WorkflowEvent = {
      id: id(),
      workflowId: workflow.id,
      runId,
      ...(stepId ? { stepId } : {}),
      type,
      occurredAt: now().toISOString(),
      detail
    };
    events.push(event);
    await ports.events.append(event);
  };
  const result = (status: WorkflowResult['status']): WorkflowResult =>
    WorkflowResultSchema.parse({
      workflowId: workflow.id,
      runId,
      status,
      startedAt,
      finishedAt: now().toISOString(),
      outputs,
      events
    });

  if (!workflow.executable) {
    await emit('workflow-blocked', { reason: 'workflow is not executable' });
    return result('blocked');
  }
  await emit('workflow-started');

  for (const precondition of workflow.preconditions) {
    const decision = await ports.preconditions.check(precondition, command);
    if (!decision.allowed) {
      await emit('workflow-blocked', { precondition, reason: decision.reason });
      return result('blocked');
    }
  }

  for (const step of workflow.steps) {
    const policy = await ports.policy.authorize(step, command);
    if (!policy.allowed) {
      await emit('workflow-blocked', { reason: policy.reason }, step.id);
      return result('blocked');
    }
    await emit('step-started', {}, step.id);
    const execution = await ports.executor.execute(step, command);
    if (execution.status === 'blocked') {
      await emit('workflow-blocked', { reason: execution.reason }, step.id);
      return result('blocked');
    }
    if (execution.status === 'failed') {
      await emit('step-failed', { error: execution.error }, step.id);
      await emit('workflow-failed', { failedStepId: step.id });
      return result('failed');
    }
    const validation = await ports.outputValidator.validate(step, execution.outputs, command);
    if (!validation.valid) {
      await emit('step-failed', { error: validation.reason }, step.id);
      await emit('workflow-failed', { failedStepId: step.id });
      return result('failed');
    }
    outputs.push(...execution.outputs);
    await emit('step-succeeded', { outputs: execution.outputs }, step.id);
  }

  await emit('workflow-succeeded');
  return result('succeeded');
}

export class FakeWorkflowLoader implements WorkflowLoader {
  constructor(public workflow: WorkflowDescriptor) {}
  load(): WorkflowDescriptor {
    return this.workflow;
  }
}

export class FakePreconditionChecker implements PreconditionChecker {
  blocked?: Precondition;
  async check(precondition: Precondition) {
    return precondition === this.blocked
      ? ({ allowed: false, reason: `blocked by ${precondition}` } as const)
      : ({ allowed: true } as const);
  }
}

export class FakePolicyEnforcer implements PolicyEnforcer {
  blockedStep?: string;
  async authorize(step: WorkflowStep) {
    return step.id === this.blockedStep
      ? ({ allowed: false, reason: `policy blocked ${step.id}` } as const)
      : ({ allowed: true } as const);
  }
}

export class FakeStepExecutor implements StepExecutor {
  readonly steps: string[] = [];
  constructor(public results: StepExecutionResult[] = []) {}
  async execute(step: WorkflowStep): Promise<StepExecutionResult> {
    this.steps.push(step.id);
    return this.results.shift() ?? { status: 'succeeded', outputs: [] };
  }
}

export class FakeEventStore implements WorkflowEventStore {
  readonly events: WorkflowEvent[] = [];
  async append(event: WorkflowEvent): Promise<void> {
    this.events.push(event);
  }
}

export class FakeOutputValidator implements OutputValidator {
  readonly steps: string[] = [];
  invalidStep?: string;
  async validate(step: WorkflowStep) {
    this.steps.push(step.id);
    return step.id === this.invalidStep
      ? ({ valid: false, reason: `invalid output from ${step.id}` } as const)
      : ({ valid: true } as const);
  }
}
