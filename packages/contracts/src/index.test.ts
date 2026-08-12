import { describe, expect, it } from 'vitest';
import {
  ClassifiedIntentSchema,
  ExternalRoleSchema,
  NormalizedCommandSchema,
  ProjectExecutionProfileSchema,
  ProjectRegistrySchema,
  RoleProfileSchema,
  WorkflowDescriptorSchema,
  WorkflowResultSchema
} from './index.js';

describe('workflow contracts', () => {
  it('limits untrusted classification to intent, project id, and declarative focus', () => {
    expect(
      ClassifiedIntentSchema.parse({
        intent: 'explore-project',
        projectId: 'checkout',
        focus: { area: 'checkout' }
      })
    ).toEqual({ intent: 'explore-project', projectId: 'checkout', focus: { area: 'checkout' } });
    expect(() =>
      ClassifiedIntentSchema.parse({
        intent: 'explore-project',
        projectId: 'checkout',
        focus: {},
        projectRoot: 'projects/attacker'
      })
    ).toThrow();
  });

  it('validates trusted project registries and environment-labelled execution profiles', () => {
    const registry = ProjectRegistrySchema.parse({
      version: 1,
      projects: [
        {
          id: '_demo',
          root: 'projects/_demo',
          githubEnvironment: 'qali-demo',
          allowedSlack: {
            teamIds: ['T1'],
            channelIds: ['C1'],
            userIds: ['U1'],
            roles: ['qa-lead-admin']
          },
          publication: { owner: 'hlemmur', repo: 'qali', branch: 'main', reviewOnly: true },
          enabledWorkflows: ['run-test-suite'],
          schedules: [],
          activeExecutionProfile: 'demo-mock'
        }
      ]
    });
    const profile = ProjectExecutionProfileSchema.parse({
      version: 1,
      id: 'demo-mock',
      projectId: '_demo',
      environmentLabel: 'mock',
      targetVariables: {
        baseUrl: 'QALI_TARGET_BASE_URL',
        allowedOrigins: 'QALI_ALLOWED_ORIGINS_JSON',
        credentials: 'QALI_TEST_CREDENTIALS_JSON',
        testData: 'QALI_TEST_DATA_JSON'
      },
      browser: { name: 'chromium', allowDownloads: false, allowPopups: false },
      rate: { maxActionsPerMinute: 60 },
      mutation: { allowed: ['append-observation', 'append-evidence'] },
      cleanup: { strategy: 'fixture-reset' },
      redaction: { patterns: [] },
      retention: { evidenceDays: 14 },
      publication: { reviewOnly: true },
      displayBadge: 'MOCK MODE'
    });

    expect(registry.projects[0]?.root).toBe('projects/_demo');
    expect(profile.environmentLabel).toBe('mock');
    expect(() =>
      ProjectExecutionProfileSchema.parse({ ...profile, displayBadge: undefined })
    ).toThrow();
  });

  it('represents Developer and QA Lead/Admin external request authority', () => {
    expect(ExternalRoleSchema.parse('developer')).toBe('developer');
    expect(ExternalRoleSchema.parse('qa-lead-admin')).toBe('qa-lead-admin');
    expect(() => ExternalRoleSchema.parse('owner')).toThrow();
  });

  it('accepts a structured normalized command with Slack correlation context', () => {
    const command = NormalizedCommandSchema.parse({
      intent: 'explore-project',
      project: { id: 'checkout', root: 'projects/checkout' },
      requestedBy: 'U123',
      externalRole: 'developer',
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
    expect(command.externalRole).toBe('developer');
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
