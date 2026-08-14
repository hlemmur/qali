import { describe, expect, it, vi } from 'vitest';
import type { ProjectExecutionProfile, ProjectRegistry } from '@qali/contracts';
import { handleSlackAction } from './actions.js';
import type { ControlStore, Correlation, GitHubPort, InboundWork, SlackPort } from './types.js';

const work = (overrides: Partial<InboundWork> = {}): InboundWork => ({
  identity: 'slack:action:1',
  requestId: 'action-1',
  kind: 'action',
  text: '{"requestId":"Ev1","runId":"42"}',
  actionId: 'run_details',
  actionValue: '{"requestId":"Ev1","runId":"42"}',
  requestedBy: 'U1',
  externalRole: 'developer',
  receivedAt: '2023-11-14T22:15:00.000Z',
  slack: { teamId: 'T1', channelId: 'C1', threadTs: '1.1', requestTs: '1.1' },
  ...overrides
});

const testRegistry: ProjectRegistry = {
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
        roles: ['developer', 'qa-lead-admin']
      },
      publication: { owner: 'hlemmur', repo: 'qali', branch: 'main', reviewOnly: true },
      enabledWorkflows: [
        'run-test-suite',
        'triage-failure',
        'explore-project',
        'generate-test-suite',
        'quality-pulse'
      ],
      schedules: [],
      activeExecutionProfile: 'demo-mock'
    }
  ]
};

const testProfile: ProjectExecutionProfile = {
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
  mutation: { allowed: ['append-observation'] },
  cleanup: { strategy: 'fixture-reset' },
  redaction: { patterns: [] },
  retention: { evidenceDays: 14 },
  publication: { reviewOnly: true },
  displayBadge: 'MOCK MODE'
};

const actionDeps = (input: {
  work: InboundWork;
  store: ControlStore;
  github: GitHubPort;
  slack: SlackPort;
}) => ({
  ...input,
  projectRegistry: testRegistry,
  executionProfiles: [testProfile]
});

describe('Slack action handling', () => {
  it('silently ignores link-only actions without posting or dispatching', async () => {
    const notices: string[] = [];
    const github: GitHubPort = { dispatch: vi.fn() };
    const store = {
      findByRequestId: vi.fn(),
      findByRunId: vi.fn(),
      markCompleted: vi.fn(),
      markDispatched: vi.fn()
    } as unknown as ControlStore;
    const slack = {
      postThreadNotice: async (input: { text: string }) => {
        notices.push(input.text);
      },
      updateResult: vi.fn()
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({ work: work({ actionId: 'open_run_url' }), store, github, slack })
    );

    expect(github.dispatch).not.toHaveBeenCalled();
    expect(store.markCompleted).toHaveBeenCalledWith('action-1', 'action-ignored');
    expect(notices).toHaveLength(0);
  });

  it('expands the result message in place', async () => {
    const github: GitHubPort = { dispatch: vi.fn() };
    const correlation: Correlation = {
      requestId: 'Ev1',
      runId: '42',
      status: 'passed',
      createdAt: '',
      updatedAt: '',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      threadTs: '1.1',
      requestTs: '1.1',
      responseTs: '2.2'
    };
    const store = {
      findByRequestId: vi.fn(async () => correlation),
      findByRunId: vi.fn(),
      markCompleted: vi.fn(),
      markDispatched: vi.fn()
    } as unknown as ControlStore;
    const slack = {
      updateResult: vi.fn(async () => undefined),
      postThreadNotice: vi.fn()
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({
        work: work({
          actionId: 'expand_run_details',
          actionValue: JSON.stringify({
            requestId: 'Ev1',
            runId: '42',
            summary: {
              runId: '42',
              status: 'passed',
              intent: 'run-test-suite',
              projectId: '_demo',
              counts: { total: 2, passed: 2, failed: 0, skipped: 0 }
            }
          })
        }),
        store,
        github,
        slack
      })
    );

    expect(slack.updateResult).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'Ev1' }),
      '2.2',
      expect.objectContaining({ expanded: true, intent: 'run-test-suite' })
    );
    expect(github.dispatch).not.toHaveBeenCalled();
  });

  it('reruns using the stored command instead of re-classifying button text', async () => {
    const notices: string[] = [];
    const github: GitHubPort = {
      dispatch: vi.fn(async () => ({ runId: '99', htmlUrl: 'https://github.test/runs/99' }))
    };
    const correlation: Correlation = {
      requestId: 'Ev1',
      runId: '42',
      workflowId: 'run-test-suite',
      status: 'failure',
      createdAt: '',
      updatedAt: '',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      threadTs: '1.1',
      requestTs: '1.1',
      commandJson: JSON.stringify({
        intent: 'run-test-suite',
        project: { id: '_demo', root: 'projects/_demo' },
        requestedBy: 'U1',
        externalRole: 'developer',
        receivedAt: '2023-11-14T22:15:00.000Z',
        parameters: { suite: 'smoke' }
      })
    };
    const store = {
      findByRequestId: vi.fn(async () => correlation),
      findByRunId: vi.fn(),
      accept: vi.fn(async () => true),
      claim: vi.fn(async () => true),
      markCompleted: vi.fn(),
      markDispatched: vi.fn()
    } as unknown as ControlStore;
    const slack = {
      postThreadNotice: vi.fn(async (input: { text: string }) => {
        notices.push(input.text);
      })
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({
        work: work({ actionId: 'rerun_workflow' }),
        store,
        github,
        slack
      })
    );

    expect(store.accept).toHaveBeenCalled();
    expect(store.claim).toHaveBeenCalled();
    expect(github.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'run-test-suite',
        project: expect.objectContaining({
          id: '_demo',
          root: 'projects/_demo',
          environment: 'qali-demo',
          executionProfileId: 'demo-mock',
          displayBadge: 'MOCK MODE'
        }),
        parameters: expect.objectContaining({ suite: 'smoke' })
      }),
      expect.stringMatching(/^rerun-/)
    );
    expect(store.markDispatched).toHaveBeenCalled();
    expect(store.markCompleted).toHaveBeenCalledWith('action-1', 'action-handled');
    expect(notices).toEqual(['Rerunning…', 'Started: https://github.test/runs/99']);
  });

  it('hydrates a trusted execution profile when rerunning without stored commandJson', async () => {
    const github: GitHubPort = {
      dispatch: vi.fn(async () => ({ runId: '100', htmlUrl: 'https://github.test/runs/100' }))
    };
    const correlation: Correlation = {
      requestId: 'Ev1',
      runId: '42',
      workflowId: 'run-test-suite',
      status: 'failure',
      createdAt: '',
      updatedAt: '',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      threadTs: '1.1',
      requestTs: '1.1'
    };
    const store = {
      findByRequestId: vi.fn(async () => correlation),
      findByRunId: vi.fn(),
      accept: vi.fn(async () => true),
      claim: vi.fn(async () => true),
      markCompleted: vi.fn(),
      markDispatched: vi.fn()
    } as unknown as ControlStore;
    const slack = {
      postThreadNotice: vi.fn(async () => undefined)
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({
        work: work({ actionId: 'rerun_workflow' }),
        store,
        github,
        slack
      })
    );

    expect(github.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'run-test-suite',
        project: expect.objectContaining({
          executionProfileId: 'demo-mock',
          environment: 'qali-demo'
        })
      }),
      expect.stringMatching(/^rerun-/)
    );
  });

  it('retracts generated tests by dispatching generate-test-suite with a retract flag', async () => {
    const github: GitHubPort = {
      dispatch: vi.fn(async () => ({ runId: '101', htmlUrl: 'https://github.test/runs/101' }))
    };
    const correlation: Correlation = {
      requestId: 'Ev1',
      runId: '42',
      workflowId: 'generate-test-suite',
      status: 'passed',
      createdAt: '',
      updatedAt: '',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      threadTs: '1.1',
      requestTs: '1.1'
    };
    const store = {
      findByRequestId: vi.fn(async () => correlation),
      findByRunId: vi.fn(),
      accept: vi.fn(async () => true),
      claim: vi.fn(async () => true),
      markCompleted: vi.fn(),
      markDispatched: vi.fn()
    } as unknown as ControlStore;
    const slack = {
      postThreadNotice: vi.fn(async () => undefined)
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({
        work: work({ actionId: 'retract_generated_tests' }),
        store,
        github,
        slack
      })
    );

    expect(github.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'generate-test-suite',
        parameters: expect.objectContaining({
          retractGeneratedTests: true,
          sourceRequestId: 'Ev1'
        })
      }),
      expect.stringMatching(/^retract-/)
    );
  });

  it('starts a test suite from the Test with Qali message shortcut', async () => {
    const github: GitHubPort = {
      dispatch: vi.fn(async () => ({ runId: '110', htmlUrl: 'https://github.test/runs/110' }))
    };
    const store = {
      findLatestByThread: vi.fn(),
      accept: vi.fn(async () => true),
      claim: vi.fn(async () => true),
      markCompleted: vi.fn(),
      markDispatched: vi.fn()
    } as unknown as ControlStore;
    const slack = {
      postThreadNotice: vi.fn(async () => undefined)
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({
        work: work({
          actionId: 'qali_test_message',
          text: 'checkout is broken on sauce demo'
        }),
        store,
        github,
        slack
      })
    );

    expect(github.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'run-test-suite',
        parameters: expect.objectContaining({
          source: 'message-shortcut',
          messageContext: 'checkout is broken on sauce demo'
        })
      }),
      expect.stringMatching(/^qali_test_message-/)
    );
  });

  it('triages from the thread correlation when using Triage with Qali', async () => {
    const github: GitHubPort = {
      dispatch: vi.fn(async () => ({ runId: '111', htmlUrl: 'https://github.test/runs/111' }))
    };
    const correlation: Correlation = {
      requestId: 'Ev1',
      runId: '42',
      workflowId: 'run-test-suite',
      status: 'failure',
      createdAt: '',
      updatedAt: '',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      threadTs: '1.1',
      requestTs: '1.1'
    };
    const store = {
      findLatestByThread: vi.fn(async () => correlation),
      accept: vi.fn(async () => true),
      claim: vi.fn(async () => true),
      markCompleted: vi.fn(),
      markDispatched: vi.fn()
    } as unknown as ControlStore;
    const slack = {
      postThreadNotice: vi.fn(async () => undefined)
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({
        work: work({ actionId: 'qali_triage_message', text: 'this test failed' }),
        store,
        github,
        slack
      })
    );

    expect(github.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'triage-failure',
        parameters: expect.objectContaining({ sourceRunId: '42', sourceRequestId: 'Ev1' })
      }),
      expect.stringMatching(/^qali_triage_message-/)
    );
  });

  it('does not dispatch triage when the thread has no Qali run', async () => {
    const github: GitHubPort = { dispatch: vi.fn() };
    const store = {
      findLatestByThread: vi.fn(async () => null),
      markCompleted: vi.fn()
    } as unknown as ControlStore;
    const notices: string[] = [];
    const slack = {
      postThreadNotice: vi.fn(async (input) => {
        notices.push(input.text);
      })
    } as unknown as SlackPort;

    await handleSlackAction(
      actionDeps({
        work: work({ actionId: 'qali_triage_message', text: 'a customer complaint' }),
        store,
        github,
        slack
      })
    );

    expect(github.dispatch).not.toHaveBeenCalled();
    expect(store.markCompleted).toHaveBeenCalledWith('action-1', 'action-handled');
    expect(notices[0]).toMatch(/Qali run in this thread/i);
  });
});
