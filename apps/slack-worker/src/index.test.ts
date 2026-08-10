import type { NormalizedCommand } from '@qali/contracts';
import { describe, expect, it, vi } from 'vitest';
import { signHmacForTest } from './security.js';
import { createWorker } from './index.js';
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
  readonly correlations = new Map<string, Correlation>();
  readonly runIndex = new Map<string, string>();

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
    if (runId) {
      row.runId = runId;
      this.runIndex.set(runId, requestId);
    }
  }

  async findByRunId(runId: string): Promise<Correlation | null> {
    const requestId = this.runIndex.get(runId);
    return requestId ? (this.correlations.get(requestId) ?? null) : null;
  }

  async markCompleted(requestId: string, status: string, responseTs?: string): Promise<void> {
    const row = this.correlations.get(requestId)!;
    row.status = status;
    if (responseTs) row.responseTs = responseTs;
  }
}

const command = (work: InboundWork): NormalizedCommand => ({
  intent: 'run-test-suite',
  project: { id: 'demo', root: 'projects/demo' },
  requestedBy: work.requestedBy,
  receivedAt: work.receivedAt,
  parameters: { suite: 'smoke' },
  slack: work.slack
});

const baseEnv = (queue: InboundWork[]): Env =>
  ({
    INBOUND_QUEUE: { send: async (work: InboundWork) => void queue.push(work) },
    SLACK_SIGNING_SECRET: 'slack-secret',
    SLACK_BOT_TOKEN: 'xoxb-test',
    GITHUB_WEBHOOK_SECRET: 'github-secret'
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
    expect(slackRequests[0]?.text).toContain('2 passed');
    expect(JSON.stringify(slackRequests[0]?.blocks)).toContain('triage_failures');
    expect(JSON.stringify(slackRequests[0]?.blocks)).toContain('open_report');
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
      slack: {} as SlackPort,
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
      receivedAt: new Date().toISOString(),
      slack: { teamId: 'T1', channelId: 'C1', threadTs: '1.1', requestTs: '1.1' }
    } satisfies InboundWork;
    await store.accept(work);
    await store.claim('Ev1');
    await store.markDispatched('Ev1', command(work), '42');
    const slack: SlackPort = {
      postResult: vi.fn(async () => '2.2'),
      updateResult: vi.fn(async () => undefined)
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
});
