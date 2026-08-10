import { describe, expect, it } from 'vitest';
import {
  NormalizedCommandSchema,
  RoleProfileSchema,
  WorkflowDescriptorSchema,
  WorkflowResultSchema
} from './index.js';

describe('workflow contracts', () => {
  it('accepts a structured normalized command with Slack correlation context', () => {
    const command = NormalizedCommandSchema.parse({
      intent: 'explore-project',
      project: { id: 'checkout', root: 'projects/checkout' },
      requestedBy: 'U123',
      receivedAt: '2026-08-10T20:00:00.000Z',
      parameters: { charter: 'Probe checkout boundaries' },
      autonomy: {
        mode: 'balanced',
        approvalRefs: [],
        allowProceedWithOpenQuestions: false
      },
      slack: {
        teamId: 'T123',
        channelId: 'C123',
        threadTs: '1723320000.000100',
        requestTs: '1723320000.000100'
      }
    });

    expect(command.intent).toBe('explore-project');
    expect(command.autonomy?.mode).toBe('balanced');
    expect(command.slack?.threadTs).toBe('1723320000.000100');
  });

  it.each(['supervised', 'bounded-autonomous'])('rejects obsolete autonomy mode %s', (mode) => {
    expect(() =>
      NormalizedCommandSchema.parse({
        intent: 'explore-project',
        project: { id: 'checkout', root: 'projects/checkout' },
        requestedBy: 'U123',
        receivedAt: '2026-08-10T20:00:00.000Z',
        parameters: {},
        autonomy: {
          mode,
          approvalRefs: [],
          allowProceedWithOpenQuestions: false
        }
      })
    ).toThrow();
  });

  it('rejects unknown contract fields and invalid role permissions', () => {
    expect(() =>
      RoleProfileSchema.parse({
        id: 'executor',
        displayName: 'Executor',
        permissions: {
          readableArtifacts: ['tests'],
          writableArtifacts: ['evidence'],
          tools: ['playwright'],
          mutations: ['append-evidence']
        },
        elevated: true
      })
    ).toThrow();
  });

  it('describes ordered workflow steps and typed results', () => {
    const workflow = WorkflowDescriptorSchema.parse({
      version: 1,
      id: 'run-test-suite',
      title: 'Run test suite',
      description: 'Run approved deterministic tests.',
      executable: true,
      triggers: [{ type: 'command', intent: 'run-test-suite' }],
      preconditions: ['execution-unblocked'],
      steps: [
        {
          id: 'execute',
          role: 'executor',
          skill: 'playwright-automation',
          needs: [],
          inputs: [{ artifact: 'tests', path: 'projects/{projectId}/tests' }],
          outputs: [
            {
              artifact: 'evidence',
              path: 'projects/{projectId}/observations/test-runs'
            }
          ],
          requiredTools: ['playwright'],
          mutations: ['append-evidence'],
          policyGates: ['execution'],
          retries: 1,
          timeoutMs: 900000
        }
      ]
    });
    const result = WorkflowResultSchema.parse({
      workflowId: workflow.id,
      runId: 'run-1',
      status: 'succeeded',
      startedAt: '2026-08-10T20:00:00.000Z',
      finishedAt: '2026-08-10T20:01:00.000Z',
      outputs: workflow.steps[0]?.outputs ?? [],
      events: []
    });

    expect(result.status).toBe('succeeded');
  });
});
