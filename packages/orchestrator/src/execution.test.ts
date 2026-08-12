import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  NormalizedCommand,
  WorkflowDescriptor,
  WorkflowResult,
  WorkflowStep
} from '../../contracts/src/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileSystemOutputValidator,
  FakeEventStore,
  FakeOutputValidator,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FakeStepExecutor,
  FakeWorkflowLoader,
  executeWorkflow
} from './index.js';

const command: NormalizedCommand = {
  intent: 'run-test-suite',
  project: { id: 'demo', root: 'projects/demo' },
  requestedBy: 'U1',
  externalRole: 'developer',
  receivedAt: '2026-08-10T20:00:00.000Z',
  slack: {
    teamId: 'T1',
    channelId: 'C1',
    threadTs: '1700000000.001',
    requestTs: '1700000000.001'
  },
  parameters: {}
};

const workflow: WorkflowDescriptor = {
  version: 1,
  id: 'run-test-suite',
  title: 'Run',
  description: 'Run deterministic checks',
  executable: true,
  triggers: [{ type: 'command', intent: 'run-test-suite' }],
  preconditions: ['project-exists', 'execution-unblocked'],
  steps: [
    {
      id: 'execute',
      role: 'executor',
      harnessProfileId: 'host-test-execution',
      needs: [],
      inputs: [],
      outputs: [{ artifact: 'evidence', path: 'projects/{projectId}/observations/evidence/run' }],
      requiredTools: ['playwright'],
      mutations: ['append-evidence'],
      policyGates: ['execution'],
      retries: 0,
      timeoutMs: 10_000
    },
    {
      id: 'report',
      role: 'reporter',
      harnessProfileId: 'human-reporting',
      needs: ['execute'],
      inputs: [],
      outputs: [{ artifact: 'reports', path: 'projects/{projectId}/derived/reports/run.md' }],
      requiredTools: ['report-renderer'],
      mutations: ['render-derived-report'],
      policyGates: [],
      retries: 0,
      timeoutMs: 10_000
    }
  ]
};

const dependencies = () => ({
  loader: new FakeWorkflowLoader(workflow),
  preconditions: new FakePreconditionChecker(),
  policy: new FakePolicyEnforcer(),
  executor: new FakeStepExecutor([
    {
      status: 'succeeded' as const,
      outputs: [{ artifact: 'evidence' as const, path: 'projects/demo/observations/evidence/run' }]
    },
    {
      status: 'succeeded' as const,
      outputs: [{ artifact: 'reports' as const, path: 'projects/demo/derived/reports/run.md' }]
    }
  ]),
  events: new FakeEventStore(),
  outputValidator: new FakeOutputValidator(),
  harnessHash: () => 'a'.repeat(64),
  resume: undefined as WorkflowResult | undefined,
  now: () => new Date('2026-08-10T20:00:00.000Z'),
  id: (() => {
    let id = 0;
    return () => `id-${++id}`;
  })()
});

describe('workflow execution', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads, executes, validates, and persists ordered state transitions', async () => {
    const ports = dependencies();
    const result = await executeWorkflow(command, ports);

    expect(result.status).toBe('succeeded');
    expect(ports.executor.steps).toEqual(['execute', 'report']);
    expect(ports.outputValidator.steps).toEqual(['execute', 'report']);
    expect(ports.events.events.map(({ type }) => type)).toEqual([
      'workflow-started',
      'step-started',
      'step-succeeded',
      'step-started',
      'step-succeeded',
      'workflow-succeeded'
    ]);
    expect(result.outputs).toHaveLength(2);
    expect(result.events[0]?.correlation).toEqual(command.slack);
    expect(result.attempts[0]?.harnessHash).toBe('a'.repeat(64));
  });

  it('stops before execution when a precondition or policy blocks work', async () => {
    const preconditionPorts = dependencies();
    preconditionPorts.preconditions.blocked = 'execution-unblocked';
    const preconditionResult = await executeWorkflow(command, preconditionPorts);
    expect(preconditionResult.status).toBe('blocked');
    expect(preconditionPorts.executor.steps).toEqual([]);

    const policyPorts = dependencies();
    policyPorts.policy.blockedStep = 'execute';
    const policyResult = await executeWorkflow(command, policyPorts);
    expect(policyResult.status).toBe('blocked');
    expect(policyPorts.executor.steps).toEqual([]);
    expect(policyResult.events.at(-1)?.type).toBe('workflow-blocked');
  });

  it('stops on step failure and invalid output', async () => {
    const failedPorts = dependencies();
    failedPorts.executor.results[0] = { status: 'failed', error: 'browser unavailable' };
    const failed = await executeWorkflow(command, failedPorts);
    expect(failed.status).toBe('failed');
    expect(failedPorts.executor.steps).toEqual(['execute']);

    const invalidPorts = dependencies();
    invalidPorts.outputValidator.invalidStep = 'execute';
    const invalid = await executeWorkflow(command, invalidPorts);
    expect(invalid.status).toBe('failed');
    expect(invalidPorts.executor.steps).toEqual(['execute']);
  });

  it('aborts a step when its declared timeout elapses', async () => {
    vi.useFakeTimers();
    const ports = dependencies();
    ports.loader.workflow = {
      ...workflow,
      steps: [{ ...workflow.steps[0]!, timeoutMs: 1_000 }]
    };
    let aborted = false;
    ports.executor.execute = vi.fn(async (_step, _command, context) => {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => {
          aborted = true;
          resolve();
        });
      });
      return { status: 'failed', error: 'cancelled' } as const;
    });

    const pending = executeWorkflow(command, ports);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result.status).toBe('failed');
    expect(aborted).toBe(true);
    expect(result.events.find(({ type }) => type === 'step-failed')?.detail).toEqual({
      error: 'step execute timed out after 1000ms'
    });
  });

  it('waits briefly for timed-out execution to settle before retrying', async () => {
    vi.useFakeTimers();
    const ports = dependencies();
    ports.loader.workflow = {
      ...workflow,
      steps: [{ ...workflow.steps[0]!, retries: 1, timeoutMs: 1_000 }]
    };
    let calls = 0;
    ports.executor.execute = vi.fn(async (_step, _command, context) => {
      calls += 1;
      if (calls === 1) {
        return await new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => {
            setTimeout(() => reject(new Error('late process rejection')), 50);
          });
        });
      }
      return {
        status: 'succeeded' as const,
        outputs: [
          { artifact: 'evidence' as const, path: 'projects/demo/observations/evidence/run' }
        ]
      };
    });

    const pending = executeWorkflow(command, ports);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(calls).toBe(2);
    expect(result.status).toBe('succeeded');
    expect(result.attempts[0]?.error).toBe('step execute timed out after 1000ms');
  });

  it('retries failed steps and persists every declared attempt', async () => {
    const ports = dependencies();
    ports.loader.workflow = {
      ...workflow,
      steps: [{ ...workflow.steps[0]!, retries: 1 }]
    };
    ports.executor.results = [
      { status: 'failed', error: 'transient browser failure' },
      {
        status: 'succeeded',
        outputs: [{ artifact: 'evidence', path: 'projects/demo/observations/evidence/run' }]
      }
    ];

    const result = await executeWorkflow(command, ports);

    expect(result.status).toBe('succeeded');
    expect(ports.executor.steps).toEqual(['execute', 'execute']);
    expect(result.attempts.map(({ attempt, status }) => ({ attempt, status }))).toEqual([
      { attempt: 1, status: 'failed' },
      { attempt: 2, status: 'succeeded' }
    ]);
    expect(
      ports.events.events
        .filter(({ attempt }) => attempt !== undefined)
        .map(({ attempt }) => attempt?.status)
    ).toEqual(['running', 'failed', 'running', 'succeeded']);
  });

  it('records thrown executor errors as retryable failed attempts', async () => {
    const ports = dependencies();
    ports.loader.workflow = {
      ...workflow,
      steps: [{ ...workflow.steps[0]!, retries: 1 }]
    };
    ports.executor.execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValueOnce({
        status: 'succeeded',
        outputs: [{ artifact: 'evidence', path: 'projects/demo/observations/evidence/run' }]
      });

    const result = await executeWorkflow(command, ports);

    expect(result.status).toBe('succeeded');
    expect(result.attempts.map(({ status, error }) => ({ status, error }))).toEqual([
      { status: 'failed', error: 'spawn failed' },
      { status: 'succeeded', error: undefined }
    ]);
  });

  it('continues failure analysis and reporting while preserving the failed outcome', async () => {
    const ports = dependencies();
    ports.loader.workflow = {
      ...workflow,
      steps: [
        { ...workflow.steps[0]!, retries: 0 },
        {
          ...workflow.steps[1]!,
          id: 'analyze-failures',
          role: 'failure-analyst',
          runIf: 'failure',
          outputs: [
            { artifact: 'reports', path: 'projects/{projectId}/derived/reports/analysis.md' }
          ]
        },
        { ...workflow.steps[1]!, needs: ['analyze-failures'], runIf: 'always' }
      ]
    };
    ports.executor.results = [
      { status: 'failed', error: 'playwright assertions failed' },
      {
        status: 'succeeded',
        outputs: [{ artifact: 'reports', path: 'projects/demo/derived/reports/analysis.md' }]
      },
      {
        status: 'succeeded',
        outputs: [{ artifact: 'reports', path: 'projects/demo/derived/reports/run.md' }]
      }
    ];

    const result = await executeWorkflow(command, ports);

    expect(ports.executor.steps).toEqual(['execute', 'analyze-failures', 'report']);
    expect(result.status).toBe('failed');
    expect(result.reportingStatus).toBe('succeeded');
    expect(result.events.at(-1)?.type).toBe('workflow-failed');
  });

  it('keeps workflow success separate from reporting failure', async () => {
    const ports = dependencies();
    ports.executor.results[1] = { status: 'failed', error: 'Slack renderer failed' };

    const result = await executeWorkflow(command, ports);

    expect(result.status).toBe('succeeded');
    expect(result.reportingStatus).toBe('failed');
    expect(result.events.at(-1)?.type).toBe('workflow-succeeded');
  });

  it('resumes a run without repeating completed steps or outputs', async () => {
    const initialPorts = dependencies();
    const initial = await executeWorkflow(command, initialPorts);
    const executeAttempt = initial.attempts.find(({ stepId }) => stepId === 'execute')!;

    const resumedPorts = dependencies();
    resumedPorts.resume = {
      ...initial,
      status: 'failed',
      reportingStatus: 'not-run',
      outputs: initial.outputs.filter(({ artifact }) => artifact === 'evidence'),
      attempts: [executeAttempt],
      events: initial.events.slice(0, 3)
    };
    resumedPorts.executor.results = [
      {
        status: 'succeeded',
        outputs: [{ artifact: 'reports', path: 'projects/demo/derived/reports/run.md' }]
      }
    ];

    const resumed = await executeWorkflow(command, resumedPorts);

    expect(resumed.runId).toBe(initial.runId);
    expect(resumedPorts.executor.steps).toEqual(['report']);
    expect(resumed.outputs).toEqual([
      { artifact: 'evidence', path: 'projects/demo/observations/evidence/run' },
      { artifact: 'reports', path: 'projects/demo/derived/reports/run.md' }
    ]);
    expect(resumed.events.filter(({ type }) => type === 'workflow-resumed')).toHaveLength(1);
    expect(resumed.attempts.filter(({ stepId }) => stepId === 'execute')).toHaveLength(1);
  });

  it('reruns a completed step when its harness identity changed', async () => {
    const initialPorts = dependencies();
    const initial = await executeWorkflow(command, initialPorts);
    const ports = dependencies();
    ports.loader.workflow = { ...workflow, steps: [workflow.steps[0]!] };
    ports.resume = {
      ...initial,
      outputs: initial.outputs.filter(({ artifact }) => artifact === 'evidence'),
      attempts: initial.attempts
        .filter(({ stepId }) => stepId === 'execute')
        .map((attempt) => ({ ...attempt, harnessHash: 'b'.repeat(64) })),
      events: []
    };
    ports.executor.results = [
      {
        status: 'succeeded',
        outputs: [{ artifact: 'evidence', path: 'projects/demo/observations/evidence/run' }]
      }
    ];

    const resumed = await executeWorkflow(command, ports);

    expect(ports.executor.steps).toEqual(['execute']);
    expect(resumed.attempts).toHaveLength(1);
    expect(resumed.attempts[0]?.harnessHash).toBe('a'.repeat(64));
    expect(resumed.outputs).toHaveLength(1);
  });

  it('continues retry numbering and budget after resume', async () => {
    const ports = dependencies();
    ports.loader.workflow = {
      ...workflow,
      steps: [{ ...workflow.steps[0]!, retries: 1 }]
    };
    ports.resume = {
      workflowId: workflow.id,
      runId: 'existing-run',
      status: 'failed',
      reportingStatus: 'not-run',
      startedAt: command.receivedAt,
      finishedAt: command.receivedAt,
      outputs: [],
      attempts: [
        {
          id: 'attempt-1',
          workflowId: workflow.id,
          runId: 'existing-run',
          stepId: 'execute',
          attempt: 1,
          harnessProfileId: 'host-test-execution',
          harnessHash: 'a'.repeat(64),
          status: 'failed',
          startedAt: command.receivedAt,
          finishedAt: command.receivedAt,
          error: 'transient failure'
        }
      ],
      events: []
    };
    ports.executor.results = [
      {
        status: 'succeeded',
        outputs: [{ artifact: 'evidence', path: 'projects/demo/observations/evidence/run' }]
      }
    ];

    const resumed = await executeWorkflow(command, ports);

    expect(resumed.status).toBe('succeeded');
    expect(resumed.attempts.map(({ attempt }) => attempt)).toEqual([1, 2]);
  });

  it('rejects declared outputs that were not materialized on disk', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-output-'));
    const validator = new FileSystemOutputValidator(workspace);
    const step = workflow.steps[0] as WorkflowStep;
    const output = {
      artifact: 'evidence' as const,
      path: 'projects/demo/observations/evidence/run'
    };

    await expect(validator.validate(step, [output], command)).resolves.toMatchObject({
      valid: false
    });

    mkdirSync(join(workspace, output.path), { recursive: true });
    writeFileSync(join(workspace, output.path, 'result.json'), '{}');
    await expect(validator.validate(step, [output], command)).resolves.toEqual({ valid: true });
  });
});
