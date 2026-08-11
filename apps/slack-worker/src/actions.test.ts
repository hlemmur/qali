import { describe, expect, it, vi } from 'vitest';
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

    await handleSlackAction({ work: work({ actionId: 'open_run_url' }), store, github, slack });

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

    await handleSlackAction({
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
    });

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

    await handleSlackAction({
      work: work({ actionId: 'rerun_workflow' }),
      store,
      github,
      slack
    });

    expect(store.accept).toHaveBeenCalled();
    expect(store.claim).toHaveBeenCalled();
    expect(github.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'run-test-suite',
        project: { id: '_demo', root: 'projects/_demo' }
      }),
      expect.stringMatching(/^rerun-/)
    );
    expect(store.markDispatched).toHaveBeenCalled();
    expect(store.markCompleted).toHaveBeenCalledWith('action-1', 'action-handled');
    expect(notices).toEqual(['Rerunning…', 'Started: https://github.test/runs/99']);
  });
});
