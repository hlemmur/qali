import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  NormalizedCommandSchema,
  WorkflowDescriptorSchema,
  WorkflowResultSchema,
  type ArtifactReference,
  type NormalizedCommand,
  type WorkflowAttempt,
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

export interface StepExecutionContext {
  signal: AbortSignal;
}

export interface StepExecutor {
  execute(
    step: WorkflowStep,
    command: NormalizedCommand,
    context: StepExecutionContext
  ): Promise<StepExecutionResult>;
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
  harnessHash(step: WorkflowStep): string;
  resume?: WorkflowResult | undefined;
  now?: () => Date;
  id?: () => string;
}

const expandOutputPath = (path: string, command: NormalizedCommand): string =>
  path.replaceAll('{projectId}', command.project.id);

async function executeWithTimeout(
  executor: StepExecutor,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StepExecutionResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: 'failed', error: `step ${step.id} timed out after ${step.timeoutMs}ms` });
    }, step.timeoutMs);
  });

  try {
    return await Promise.race([
      executor.execute(step, command, { signal: controller.signal }),
      timeout
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
  const resume = ports.resume ? WorkflowResultSchema.parse(ports.resume) : undefined;
  if (resume && resume.workflowId !== workflow.id) {
    throw new Error(`cannot resume ${resume.workflowId} as ${workflow.id}`);
  }
  const runId = resume?.runId ?? id();
  const startedAt = resume?.startedAt ?? now().toISOString();
  const events: WorkflowEvent[] = [...(resume?.events ?? [])];
  const outputs: ArtifactReference[] = [...(resume?.outputs ?? [])];
  const attempts: WorkflowAttempt[] = [...(resume?.attempts ?? [])];
  const stepRoles = new Map(workflow.steps.map((step) => [step.id, step.role]));
  let workflowFailed = attempts.some(
    (attempt) => attempt.status === 'failed' && stepRoles.get(attempt.stepId) !== 'reporter'
  );
  let failedStepId = attempts.find(
    (attempt) => attempt.status === 'failed' && stepRoles.get(attempt.stepId) !== 'reporter'
  )?.stepId;
  let reportingStatus: WorkflowResult['reportingStatus'] =
    resume?.reportingStatus ?? 'not-run';

  const emit = async (
    type: WorkflowEvent['type'],
    detail: Record<string, unknown> = {},
    stepId?: string,
    attempt?: WorkflowAttempt
  ): Promise<void> => {
    const event: WorkflowEvent = {
      id: id(),
      workflowId: workflow.id,
      runId,
      ...(stepId ? { stepId } : {}),
      ...(attempt ? { attempt } : {}),
      ...(command.slack ? { correlation: command.slack } : {}),
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
      reportingStatus,
      startedAt,
      finishedAt: now().toISOString(),
      outputs,
      attempts,
      events
    });

  if (!workflow.executable) {
    await emit('workflow-blocked', { reason: 'workflow is not executable' });
    return result('blocked');
  }
  await emit(resume ? 'workflow-resumed' : 'workflow-started');

  for (const precondition of workflow.preconditions) {
    const decision = await ports.preconditions.check(precondition, command);
    if (!decision.allowed) {
      await emit('workflow-blocked', { precondition, reason: decision.reason });
      return result('blocked');
    }
  }

  const completedStepIds = new Set(
    attempts.filter(({ status }) => status === 'succeeded').map(({ stepId }) => stepId)
  );
  for (const step of workflow.steps) {
    if (completedStepIds.has(step.id)) continue;
    const runIf = step.runIf ?? 'success';
    if (
      (runIf === 'success' && workflowFailed) ||
      (runIf === 'failure' && !workflowFailed)
    ) {
      continue;
    }
    const policy = await ports.policy.authorize(step, command);
    if (!policy.allowed) {
      await emit('workflow-blocked', { reason: policy.reason }, step.id);
      return result('blocked');
    }
    for (let attemptNumber = 1; attemptNumber <= step.retries + 1; attemptNumber += 1) {
      const runningAttempt: WorkflowAttempt = {
        id: id(),
        workflowId: workflow.id,
        runId,
        stepId: step.id,
        attempt: attemptNumber,
        harnessProfileId: step.harnessProfileId,
        harnessHash: ports.harnessHash(step),
        status: 'running',
        startedAt: now().toISOString()
      };
      await emit('step-started', {}, step.id, runningAttempt);
      const execution = await executeWithTimeout(ports.executor, step, command);
      if (execution.status === 'blocked') {
        const blockedAttempt: WorkflowAttempt = {
          ...runningAttempt,
          status: 'blocked',
          finishedAt: now().toISOString(),
          error: execution.reason
        };
        attempts.push(blockedAttempt);
        await emit(
          'workflow-blocked',
          { reason: execution.reason },
          step.id,
          blockedAttempt
        );
        return result('blocked');
      }

      let error: string | undefined;
      let attemptOutputs: ArtifactReference[] = [];
      if (execution.status === 'failed') {
        error = execution.error;
      } else {
        attemptOutputs = execution.outputs;
        const validation = await ports.outputValidator.validate(step, execution.outputs, command);
        if (!validation.valid) error = validation.reason;
      }

      if (error) {
        const failedAttempt: WorkflowAttempt = {
          ...runningAttempt,
          status: 'failed',
          finishedAt: now().toISOString(),
          error
        };
        attempts.push(failedAttempt);
        await emit('step-failed', { error }, step.id, failedAttempt);
        if (attemptNumber <= step.retries) continue;
        workflowFailed = true;
        failedStepId ??= step.id;
        if (step.role === 'reporter') reportingStatus = 'failed';
        break;
      }

      const succeededAttempt: WorkflowAttempt = {
        ...runningAttempt,
        status: 'succeeded',
        finishedAt: now().toISOString()
      };
      attempts.push(succeededAttempt);
      outputs.push(...attemptOutputs);
      await emit('step-succeeded', { outputs: attemptOutputs }, step.id, succeededAttempt);
      if (step.role === 'reporter') reportingStatus = 'succeeded';
      break;
    }
  }

  if (workflowFailed) {
    await emit('workflow-failed', { failedStepId });
    return result('failed');
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
  async execute(
    step: WorkflowStep,
    _command: NormalizedCommand,
    _context: StepExecutionContext
  ): Promise<StepExecutionResult> {
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
