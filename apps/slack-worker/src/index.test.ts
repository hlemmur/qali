import type {
  ClassifiedIntent,
  NormalizedCommand,
  ProjectExecutionProfile,
  ProjectRegistry
} from '@qali/contracts';
import { describe, expect, it, vi } from 'vitest';
import { signHmacForTest } from './security.js';
import { createWorker as createProductionWorker, type WorkerDependencies } from './index.js';
import { SlackWebClient } from './slack.js';
import type {
  ControlStore,
  Correlation,
  Env,
  GitHubPort,
  InboundWork,
  IntentClassifier,
  SlackPort
} from './types.js';

class MemoryStore implements ControlStore {
  readonly accepted = new Map<string, InboundWork>();
  readonly callbacks = new Set<string>();
  readonly correlations = new Map<string, Correlation>();
  readonly runIndex = new Map<string, string>();
  readonly denials: Array<{ reasonCode: string; requestKind: string }> = [];
  readonly rateEvents = new Map<string, string[]>();

  async accept(work: InboundWork): Promise<boolean> {
    if (this.accepted.has(work.identity)) return false;
    this.accepted.set(work.identity, work);
    this.correlations.set(work.requestId, {
      requestId: work.requestId,
      status: 'queued',
      createdAt: work.receivedAt,
      updatedAt: work.receivedAt,
      teamId: work.slack.teamId,
      channelId: work.slack.channelId,
      userId: work.requestedBy,
      threadTs: work.slack.threadTs,
      requestTs: work.slack.requestTs
    });
    return true;
  }

  async acceptCallback(identity: string): Promise<boolean> {
    if (this.callbacks.has(identity)) return false;
    this.callbacks.add(identity);
    return true;
  }

  async recordSecurityDenial(input: {
    occurredAt: string;
    reasonCode: string;
    requestKind: string;
  }): Promise<void> {
    this.denials.push({ reasonCode: input.reasonCode, requestKind: input.requestKind });
  }

  async consumeRateLimit(input: {
    scope: string;
    subjectHash: string;
    eventId: string;
    occurredAt: string;
    windowStart: string;
    limit: number;
  }): Promise<'accepted' | 'duplicate' | 'limited'> {
    if ([...this.rateEvents.values()].some((events) => events.includes(input.eventId))) {
      return 'duplicate';
    }
    const key = `${input.scope}:${input.subjectHash}`;
    const events = this.rateEvents.get(key) ?? [];
    if (events.length >= input.limit) return 'limited';
    events.push(input.eventId);
    this.rateEvents.set(key, events);
    return 'accepted';
  }

  async claim(requestId: string): Promise<boolean> {
    const row = this.correlations.get(requestId);
    if (!row || row.status !== 'queued') return false;
    row.status = 'processing';
    return true;
  }

  async requeue(requestId: string): Promise<void> {
    const row = this.correlations.get(requestId);
    if (row) row.status = 'queued';
  }

  async markDispatched(
    requestId: string,
    command: NormalizedCommand,
    runId?: string
  ): Promise<void> {
    const row = this.correlations.get(requestId)!;
    row.status = 'dispatched';
    row.workflowId = command.intent;
    row.commandJson = JSON.stringify(command);
    if (runId) {
      row.runId = runId;
      this.runIndex.set(runId, requestId);
    }
  }

  async findByRunId(runId: string): Promise<Correlation | null> {
    const requestId = this.runIndex.get(runId);
    return requestId ? (this.correlations.get(requestId) ?? null) : null;
  }

  async findByRequestId(requestId: string): Promise<Correlation | null> {
    return this.correlations.get(requestId) ?? null;
  }

  async markCompleted(
    requestId: string,
    status: string,
    responseTs?: string,
    lastError?: string
  ): Promise<void> {
    const row = this.correlations.get(requestId)!;
    row.status = status;
    if (responseTs) row.responseTs = responseTs;
    if (lastError) row.lastError = lastError;
  }
}

const command = (work: InboundWork): ClassifiedIntent => {
  void work;
  return {
    intent: 'run-test-suite',
    projectId: '_demo',
    focus: { suite: 'smoke' }
  };
};

const resolvedCommand = (work: InboundWork): NormalizedCommand => ({
  intent: 'run-test-suite',
  project: {
    id: '_demo',
    root: 'projects/_demo',
    environment: 'qali-demo',
    environmentLabel: 'mock',
    executionProfileId: 'demo-mock',
    publication: { owner: 'hlemmur', repo: 'qali', branch: 'main', reviewOnly: true },
    displayBadge: 'MOCK MODE'
  },
  requestedBy: work.requestedBy,
  externalRole: work.externalRole,
  receivedAt: work.receivedAt,
  parameters: { suite: 'smoke' },
  slack: work.slack
});

const testProjectRegistry: ProjectRegistry = {
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
        'onboard-project',
        'explore-project',
        'generate-test-suite',
        'run-test-suite',
        'triage-failure',
        'maintain-knowledge',
        'maintain-suite',
        'quality-pulse'
      ],
      schedules: [],
      activeExecutionProfile: 'demo-mock'
    }
  ]
};
const testExecutionProfile: ProjectExecutionProfile = {
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
  mutation: { allowed: [] },
  cleanup: { strategy: 'fixture-reset' },
  redaction: { patterns: [] },
  retention: { evidenceDays: 14 },
  publication: { reviewOnly: true },
  displayBadge: 'MOCK MODE'
};
const createWorker = (overrides: WorkerDependencies = {}) =>
  createProductionWorker({
    projectRegistry: testProjectRegistry,
    executionProfiles: [testExecutionProfile],
    ...overrides
  });

const baseEnv = (queue: InboundWork[]): Env =>
  ({
    INBOUND_QUEUE: { send: async (work: InboundWork) => void queue.push(work) },
    SLACK_SIGNING_SECRET: 'slack-secret',
    SLACK_BOT_TOKEN: 'xoxb-test',
    GITHUB_WEBHOOK_SECRET: 'github-secret',
    QALI_CALLBACK_SECRET: 'callback-secret'
  }) as Env;

async function slackEvent(body: unknown, timestamp = '1700000000'): Promise<Request> {
  const raw = JSON.stringify(body);
  const signature = await signHmacForTest('slack-secret', `v0:${timestamp}:${raw}`, 'v0=');
  return new Request('https://worker.test/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature
    },
    body: raw
  });
}

async function slackAction(body: unknown): Promise<Request> {
  const timestamp = '1700000000';
  const raw = new URLSearchParams({ payload: JSON.stringify(body) }).toString();
  const signature = await signHmacForTest('slack-secret', `v0:${timestamp}:${raw}`, 'v0=');
  return new Request('https://worker.test/slack/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature
    },
    body: raw
  });
}

const eventBody = {
  type: 'event_callback',
  team_id: 'T1',
  event_id: 'Ev1',
  event: {
    type: 'app_mention',
    user: 'U1',
    channel: 'C1',
    ts: '1700000000.001',
    text: '<@BOT> run smoke tests'
  }
};

describe('Slack control worker', () => {
  it('spans signed intake, queue normalization, dispatch, callback, and compact rendering', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const slackRequests: Array<Record<string, unknown>> = [];
    const slack = new SlackWebClient('xoxb-mock', async (_url, init) => {
      slackRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ ok: true, ts: '2.2' });
    });
    const worker = createWorker({
      store,
      classifier: { classify: async (work) => command(work) },
      github: { dispatch: async () => ({ runId: '42' }) },
      slack,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });

    expect((await worker.fetch(await slackEvent(eventBody), baseEnv(queue))).status).toBe(200);
    const message = { body: queue[0]!, ack: vi.fn(), retry: vi.fn() };
    await worker.queue({ messages: [message] }, baseEnv(queue));
    expect(store.correlations.get('Ev1')).toMatchObject({
      workflowId: 'run-test-suite',
      runId: '42'
    });

    const callbackBody = JSON.stringify({
      action: 'completed',
      workflow_run: {
        id: 42,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.test/runs/42',
        artifacts_url: 'https://github.test/runs/42/report'
      },
      qali_summary: { total: 3, passed: 2, failed: 0, skipped: 1 }
    });
    const callbackSignature = await signHmacForTest('github-secret', callbackBody, 'sha256=');
    const callback = new Request('https://worker.test/github/webhook', {
      method: 'POST',
      headers: {
        'x-github-event': 'workflow_run',
        'x-hub-signature-256': callbackSignature
      },
      body: callbackBody
    });

    expect((await worker.fetch(callback, baseEnv(queue))).status).toBe(200);
    const resultMessage = slackRequests.find((entry) =>
      String(entry.text ?? '').includes('2 passed')
    );
    expect(resultMessage?.text).toContain('2 passed');
    expect(JSON.stringify(resultMessage?.blocks)).toContain('open_run_url');
    expect(JSON.stringify(resultMessage?.blocks)).not.toContain('triage_failures');
    expect(JSON.stringify(resultMessage?.blocks)).toContain('expand_run_details');
    expect(JSON.stringify(resultMessage?.blocks)).not.toContain('open_report');
  });

  it('authenticates and ACKs before classifier or GitHub work', async () => {
    const queue: InboundWork[] = [];
    const classifier = { classify: vi.fn() };
    const github = { dispatch: vi.fn() };
    const worker = createWorker({
      store: new MemoryStore(),
      classifier: classifier as unknown as IntentClassifier,
      github: github as unknown as GitHubPort,
      slack: {} as SlackPort,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });

    const response = await worker.fetch(await slackEvent(eventBody), baseEnv(queue));

    expect(response.status).toBe(200);
    expect(queue).toHaveLength(1);
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(github.dispatch).not.toHaveBeenCalled();
  });

  it('rejects invalid and replayed signatures', async () => {
    const worker = createWorker({
      store: new MemoryStore(),
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack: {} as SlackPort,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    const invalid = await slackEvent(eventBody);
    invalid.headers.set('x-slack-signature', 'v0=bad');

    expect((await worker.fetch(invalid, baseEnv([]))).status).toBe(401);
    expect(
      (await worker.fetch(await slackEvent(eventBody, '1699999600'), baseEnv([]))).status
    ).toBe(401);
  });

  it('applies allowlists, filters bot loops, deduplicates, and handles verification', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const worker = createWorker({
      store,
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack: {} as SlackPort,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    const env = {
      ...baseEnv(queue),
      SLACK_ALLOWED_TEAM_IDS: 'T1',
      SLACK_ALLOWED_CHANNEL_IDS: 'C1',
      SLACK_ALLOWED_USER_IDS: 'U1'
    };

    await worker.fetch(await slackEvent(eventBody), env);
    await worker.fetch(await slackEvent(eventBody), env);
    expect(queue).toHaveLength(1);

    const denied = structuredClone(eventBody);
    denied.event.user = 'U2';
    denied.event_id = 'Ev2';
    expect((await worker.fetch(await slackEvent(denied), env)).status).toBe(403);
    expect(store.denials).toEqual([{ reasonCode: 'intake_allowlist', requestKind: 'message' }]);
    expect(JSON.stringify(store.denials)).not.toContain(denied.event.text);

    const bot = structuredClone(eventBody);
    (bot.event as typeof bot.event & { bot_id: string }).bot_id = 'B1';
    bot.event_id = 'Ev3';
    await worker.fetch(await slackEvent(bot), env);
    expect(queue).toHaveLength(1);

    const verification = await worker.fetch(
      await slackEvent({ type: 'url_verification', challenge: 'challenge-token' }),
      env
    );
    expect(await verification.text()).toBe('challenge-token');
  });

  it('rate limits user intake without storing the Slack user id', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const worker = createWorker({
      store,
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack: {} as SlackPort,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    const env = { ...baseEnv(queue), QALI_USER_RATE_LIMIT_PER_MINUTE: '1' };
    const second = structuredClone(eventBody);
    second.event_id = 'Ev2';

    expect((await worker.fetch(await slackEvent(eventBody), env)).status).toBe(200);
    expect((await worker.fetch(await slackEvent(second), env)).status).toBe(429);
    expect(queue).toHaveLength(1);
    expect([...store.rateEvents.keys()].join(',')).not.toContain('U1');
    expect(store.denials).toContainEqual({
      reasonCode: 'rate_limit_user',
      requestKind: 'message'
    });
  });

  it('rate limits resolved project dispatch independently from intake limits', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const github: GitHubPort = { dispatch: vi.fn(async () => ({ runId: '42' })) };
    const worker = createWorker({
      store,
      classifier: { classify: async (work) => command(work) },
      github,
      slack: {
        postResult: vi.fn(),
        updateResult: vi.fn(),
        postThreadNotice: vi.fn(async () => undefined)
      },
      executionProfiles: [{ ...testExecutionProfile, rate: { maxActionsPerMinute: 1 } }],
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    const second = structuredClone(eventBody);
    second.event_id = 'Ev2';
    await worker.fetch(await slackEvent(eventBody), baseEnv(queue));
    await worker.fetch(await slackEvent(second), baseEnv(queue));

    for (const work of queue) {
      await worker.queue(
        { messages: [{ body: work, ack: vi.fn(), retry: vi.fn() }] },
        baseEnv(queue)
      );
    }

    expect(github.dispatch).toHaveBeenCalledTimes(1);
    expect(store.correlations.get('Ev2')?.status).toBe('rejected');
    expect(store.denials).toContainEqual({
      reasonCode: 'rate_limit_project',
      requestKind: 'message'
    });
    expect([...store.rateEvents.keys()].join(',')).not.toContain('_demo');
  });

  it('maps QA Lead IDs and defaults allowed Slack users to Developer before queueing', async () => {
    const queue: InboundWork[] = [];
    const worker = createWorker({
      store: new MemoryStore(),
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack: {} as SlackPort,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });

    await worker.fetch(await slackEvent(eventBody), {
      ...baseEnv(queue),
      SLACK_QA_LEAD_USER_IDS: 'U1'
    });
    expect(queue[0]?.externalRole).toBe('qa-lead-admin');

    const developer = structuredClone(eventBody);
    developer.event_id = 'Ev2';
    developer.event.user = 'U2';
    await worker.fetch(await slackEvent(developer), {
      ...baseEnv(queue),
      SLACK_QA_LEAD_USER_IDS: 'U1'
    });
    expect(queue[1]?.externalRole).toBe('developer');
  });

  it('rejects privileged Developer actions before queueing', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const worker = createWorker({
      store,
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack: {} as SlackPort,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    const payload = {
      type: 'block_actions',
      team: { id: 'T1' },
      channel: { id: 'C1' },
      user: { id: 'U1' },
      message: { ts: '1700000000.001' },
      container: { thread_ts: '1700000000.001' },
      actions: [{ action_id: 'change_autonomy', action_ts: '1700000001.001' }]
    };

    expect((await worker.fetch(await slackAction(payload), baseEnv(queue))).status).toBe(403);
    expect(queue).toHaveLength(0);
    expect(store.denials).toEqual([{ reasonCode: 'privileged_action', requestKind: 'action' }]);
  });

  it('normalizes and dispatches only in the queue consumer, once across retries', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const classifier: IntentClassifier = { classify: vi.fn(async (work) => command(work)) };
    const github: GitHubPort = {
      dispatch: vi.fn(async () => ({ runId: '42', htmlUrl: 'https://github.test/runs/42' }))
    };
    const worker = createWorker({
      store,
      classifier,
      github,
      slack: {
        postResult: vi.fn(),
        updateResult: vi.fn(),
        postThreadNotice: vi.fn(async () => undefined)
      },
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    await worker.fetch(await slackEvent(eventBody), baseEnv(queue));
    const message = { body: queue[0]!, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, baseEnv(queue));
    await worker.queue({ messages: [message] }, baseEnv(queue));

    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(github.dispatch).toHaveBeenCalledTimes(1);
    expect(github.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'run-test-suite' }),
      'Ev1'
    );
    expect(store.correlations.get('Ev1')).toMatchObject({
      workflowId: 'run-test-suite',
      runId: '42',
      status: 'dispatched'
    });
  });

  it('rejects unauthorized Developer commands after classification and before dispatch', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const github: GitHubPort = { dispatch: vi.fn() };
    const worker = createWorker({
      store,
      classifier: {
        classify: async (work) => ({ ...command(work), intent: 'maintain-suite' })
      },
      github,
      slack: {
        postResult: vi.fn(),
        updateResult: vi.fn(),
        postThreadNotice: vi.fn(async () => undefined)
      },
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    await worker.fetch(await slackEvent(eventBody), baseEnv(queue));
    const message = { body: queue[0]!, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, baseEnv(queue));

    expect(github.dispatch).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(store.correlations.get('Ev1')?.status).toBe('rejected');
    expect(store.denials).toEqual([
      { reasonCode: 'command_authorization', requestKind: 'message' }
    ]);
  });

  it('posts a Slack failure notice and stops retrying when queue processing throws', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const notices: Array<{ channelId: string; threadTs: string; text: string }> = [];
    const worker = createWorker({
      store,
      classifier: {
        classify: async () => {
          throw new Error('Workers AI classification failed');
        }
      },
      github: { dispatch: vi.fn() },
      slack: {
        postResult: vi.fn(),
        updateResult: vi.fn(),
        postThreadNotice: async (input) => {
          notices.push(input);
        }
      },
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    await worker.fetch(await slackEvent(eventBody), baseEnv(queue));
    const message = { body: queue[0]!, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, baseEnv(queue));

    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(store.correlations.get('Ev1')?.status).toBe('failed');
    expect(store.correlations.get('Ev1')?.lastError).toContain('Workers AI classification failed');
    expect(notices.some((notice) => notice.text.includes('Workers AI classification failed'))).toBe(
      true
    );
    expect(notices.some((notice) => notice.text.includes('Working on it'))).toBe(true);
  });

  it('retries transient queue failures without marking the request complete', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const worker = createWorker({
      store,
      classifier: {
        classify: async () => {
          throw new Error('Workers AI returned 503');
        }
      },
      github: { dispatch: vi.fn() },
      slack: {
        postResult: vi.fn(),
        updateResult: vi.fn(),
        postThreadNotice: vi.fn(async () => undefined)
      },
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    await worker.fetch(await slackEvent(eventBody), baseEnv(queue));
    const message = { body: queue[0]!, attempts: 1, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, baseEnv(queue));

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(store.correlations.get('Ev1')).toMatchObject({ status: 'queued' });
  });

  it('does not dispatch twice when a transient failure happens after dispatch', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const dispatch = vi.fn(async () => ({ runId: '42' }));
    const worker = createWorker({
      store,
      classifier: { classify: async (work) => command(work) },
      github: { dispatch },
      slack: {
        postResult: vi.fn(),
        updateResult: vi.fn(),
        postThreadNotice: vi.fn(async ({ text }) => {
          if (text.startsWith('Started')) throw new Error('Slack network timeout');
        })
      },
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    await worker.fetch(await slackEvent(eventBody), baseEnv(queue));
    const first = { body: queue[0]!, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    const redelivery = { body: queue[0]!, attempts: 2, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [first] }, baseEnv(queue));
    await worker.queue({ messages: [redelivery] }, baseEnv(queue));

    expect(dispatch).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
    expect(store.correlations.get('Ev1')).toMatchObject({ status: 'dispatched', runId: '42' });
  });

  it('dead-letters an exhausted transient queue delivery', async () => {
    const queue: InboundWork[] = [];
    const store = new MemoryStore();
    const worker = createWorker({
      store,
      classifier: { classify: async (work) => command(work) },
      github: {
        dispatch: async () => {
          throw new Error('network timeout');
        }
      },
      slack: {
        postResult: vi.fn(),
        updateResult: vi.fn(),
        postThreadNotice: vi.fn(async () => undefined)
      },
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    await worker.fetch(await slackEvent(eventBody), baseEnv(queue));
    const message = { body: queue[0]!, attempts: 3, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, baseEnv(queue));

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(store.correlations.get('Ev1')).toMatchObject({
      status: 'dead-lettered',
      lastError: 'network timeout'
    });
  });

  it('accepts signed interactive actions as deduplicated queue work', async () => {
    const queue: InboundWork[] = [];
    const worker = createWorker({
      store: new MemoryStore(),
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack: {} as SlackPort,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    const payload = {
      type: 'block_actions',
      team: { id: 'T1' },
      channel: { id: 'C1' },
      user: { id: 'U1' },
      message: { ts: '1700000000.001' },
      container: { thread_ts: '1700000000.001' },
      actions: [
        {
          action_id: 'rerun_workflow',
          action_ts: '1700000001.001',
          value: '{"requestId":"Ev1","runId":"42"}'
        }
      ]
    };

    expect((await worker.fetch(await slackAction(payload), baseEnv(queue))).status).toBe(200);
    expect((await worker.fetch(await slackAction(payload), baseEnv(queue))).status).toBe(200);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      kind: 'action',
      actionId: 'rerun_workflow',
      requestedBy: 'U1'
    });
  });

  it('verifies GitHub callbacks and posts the correlated Slack result', async () => {
    const store = new MemoryStore();
    const work = {
      identity: 'event:Ev1',
      requestId: 'Ev1',
      kind: 'message',
      text: 'run',
      requestedBy: 'U1',
      externalRole: 'developer',
      receivedAt: new Date().toISOString(),
      slack: { teamId: 'T1', channelId: 'C1', threadTs: '1.1', requestTs: '1.1' }
    } satisfies InboundWork;
    await store.accept(work);
    await store.claim('Ev1');
    await store.markDispatched('Ev1', resolvedCommand(work), '42');
    const slack: SlackPort = {
      postResult: vi.fn(async () => '2.2'),
      updateResult: vi.fn(async () => undefined),
      postThreadNotice: vi.fn(async () => undefined)
    };
    const worker = createWorker({
      store,
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack,
      now: () => new Date()
    });
    const raw = JSON.stringify({
      action: 'completed',
      workflow_run: {
        id: 42,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.test/runs/42',
        artifacts_url: 'https://api.github.test/runs/42/artifacts'
      }
    });
    const signature = await signHmacForTest('github-secret', raw, 'sha256=');
    const request = new Request('https://worker.test/github/webhook', {
      method: 'POST',
      headers: {
        'x-github-event': 'workflow_run',
        'x-hub-signature-256': signature
      },
      body: raw
    });

    expect((await worker.fetch(request, baseEnv([]))).status).toBe(200);
    expect(slack.postResult).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'Ev1' }),
      expect.objectContaining({ runId: '42', conclusion: 'success' })
    );
    expect(store.correlations.get('Ev1')).toMatchObject({ status: 'success', responseTs: '2.2' });

    const forged = new Request('https://worker.test/github/webhook', {
      method: 'POST',
      headers: {
        'x-github-event': 'workflow_run',
        'x-hub-signature-256': 'sha256=forged'
      },
      body: raw
    });
    expect((await worker.fetch(forged, baseEnv([]))).status).toBe(401);
  });

  it('accepts each fresh Actions callback nonce only once', async () => {
    const store = new MemoryStore();
    const work = {
      identity: 'event:Ev1',
      requestId: 'Ev1',
      kind: 'message',
      text: 'run',
      requestedBy: 'U1',
      externalRole: 'developer',
      receivedAt: '2023-11-14T22:13:20.000Z',
      slack: { teamId: 'T1', channelId: 'C1', threadTs: '1.1', requestTs: '1.1' }
    } satisfies InboundWork;
    await store.accept(work);
    const slack: SlackPort = {
      postResult: vi.fn(async () => '2.2'),
      updateResult: vi.fn(async () => undefined),
      postThreadNotice: vi.fn(async () => undefined)
    };
    const worker = createWorker({
      store,
      classifier: {} as IntentClassifier,
      github: {} as GitHubPort,
      slack,
      now: () => new Date('2023-11-14T22:15:00.000Z')
    });
    const body = JSON.stringify({
      requestId: 'Ev1',
      status: 'passed',
      errors: ['Authorization: Bearer callback-token', 'employee-1234 failed'],
      evidence: ['customer-42/screenshot.png']
    });
    const timestamp = '1700000000';
    const nonce = 'run-42-attempt-1';
    const signature = await signHmacForTest(
      'callback-secret',
      `${timestamp}.${nonce}.${body}`,
      'sha256='
    );
    const callback = () =>
      new Request('https://worker.test/github/run-summary', {
        method: 'POST',
        headers: {
          'x-qali-timestamp': timestamp,
          'x-qali-nonce': nonce,
          'x-qali-signature': signature
        },
        body
      });

    const env = baseEnv([]);
    env.QALI_REDACTION_PATTERNS_JSON = '["employee-[0-9]+"]';
    env.QALI_SENSITIVE_VALUES_JSON = '["customer-42"]';
    expect((await worker.fetch(callback(), env)).status).toBe(200);
    expect(await (await worker.fetch(callback(), baseEnv([]))).json()).toEqual({
      ok: true,
      skipped: 'replay'
    });
    expect(slack.postResult).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(slack.postResult).mock.calls[0]?.[1])).not.toMatch(
      /callback-token|employee-1234|customer-42/
    );
  });
});
