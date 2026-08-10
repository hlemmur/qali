import { WorkersAiIntentClassifier } from './classifier.js';
import { GitHubAppClient } from './github.js';
import { verifySignedRequest } from './security.js';
import { SlackWebClient } from './slack.js';
import { D1ControlStore } from './store.js';
import type {
  ControlStore,
  Env,
  GitHubPort,
  InboundWork,
  IntentClassifier,
  SlackPort,
  SlackRunSummary
} from './types.js';

interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(): void;
}

interface QueueBatch<T> {
  messages: Array<QueueMessage<T>>;
}

export interface WorkerDependencies {
  store?: ControlStore;
  classifier?: IntentClassifier;
  github?: GitHubPort;
  slack?: SlackPort;
  now?: () => Date;
}

const csv = (value?: string): Set<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

function allowed(env: Env, teamId: string, channelId: string, userId: string): boolean {
  const checks: Array<[Set<string>, string]> = [
    [csv(env.SLACK_ALLOWED_TEAM_IDS), teamId],
    [csv(env.SLACK_ALLOWED_CHANNEL_IDS), channelId],
    [csv(env.SLACK_ALLOWED_USER_IDS), userId]
  ];
  return checks.every(([allowlist, value]) => allowlist.size === 0 || allowlist.has(value));
}

const storeService = (env: Env, overrides: WorkerDependencies): ControlStore =>
  overrides.store ?? new D1ControlStore(env.DB);

const slackService = (env: Env, overrides: WorkerDependencies): SlackPort =>
  overrides.slack ?? new SlackWebClient(env.SLACK_BOT_TOKEN);

function classifierService(env: Env, overrides: WorkerDependencies): IntentClassifier {
  if (overrides.classifier) return overrides.classifier;
  if (!env.AI) throw new Error('AI binding is required');
  return new WorkersAiIntentClassifier(env.AI, env.INTENT_MODEL);
}

const githubService = (env: Env, overrides: WorkerDependencies): GitHubPort =>
  overrides.github ??
  new GitHubAppClient({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId: env.GITHUB_INSTALLATION_ID,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    workflowFile: env.GITHUB_WORKFLOW_FILE,
    ref: env.GITHUB_REF ?? 'main',
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com'
  });

function json(status: number, value: unknown): Response {
  return Response.json(value, { status });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function acceptWork(work: InboundWork, env: Env, store: ControlStore): Promise<Response> {
  if (!allowed(env, work.slack.teamId, work.slack.channelId, work.requestedBy)) {
    return new Response('Forbidden', { status: 403 });
  }
  if (await store.accept(work)) await env.INBOUND_QUEUE.send(work);
  return json(200, { ok: true });
}

async function slackEvents(
  request: Request,
  env: Env,
  store: ControlStore,
  now: Date
): Promise<Response> {
  const raw = await request.text();
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const valid = await verifySignedRequest({
    secret: env.SLACK_SIGNING_SECRET,
    body: raw,
    signature: request.headers.get('x-slack-signature'),
    timestamp,
    nowSeconds: Math.floor(now.getTime() / 1000),
    prefix: 'v0='
  });
  if (!valid) return new Response('Unauthorized', { status: 401 });

  let payload: Record<string, unknown>;
  try {
    payload = record(JSON.parse(raw));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
    return new Response(payload.challenge);
  }
  if (payload.type !== 'event_callback' || typeof payload.event_id !== 'string') {
    return new Response('Ignored', { status: 200 });
  }
  const event = record(payload.event);
  const isMessage =
    event?.type === 'app_mention' || (event?.type === 'message' && event?.channel_type === 'im');
  const isBot =
    Boolean(event?.bot_id) ||
    event?.subtype === 'bot_message' ||
    (env.SLACK_BOT_USER_ID && event?.user === env.SLACK_BOT_USER_ID);
  if (!isMessage || isBot) return new Response('Ignored', { status: 200 });
  if (
    typeof payload.team_id !== 'string' ||
    typeof event.channel !== 'string' ||
    typeof event.user !== 'string' ||
    typeof event.ts !== 'string' ||
    typeof event.text !== 'string'
  ) {
    return new Response('Bad Request', { status: 400 });
  }
  const work: InboundWork = {
    identity: `slack:event:${payload.event_id}`,
    requestId: payload.event_id,
    kind: 'message',
    text: event.text,
    requestedBy: event.user,
    receivedAt: now.toISOString(),
    slack: {
      teamId: payload.team_id,
      channelId: event.channel,
      threadTs: typeof event.thread_ts === 'string' ? event.thread_ts : event.ts,
      requestTs: event.ts
    }
  };
  return acceptWork(work, env, store);
}

async function slackInteraction(
  request: Request,
  env: Env,
  store: ControlStore,
  now: Date
): Promise<Response> {
  const raw = await request.text();
  const timestamp = request.headers.get('x-slack-request-timestamp');
  if (
    !(await verifySignedRequest({
      secret: env.SLACK_SIGNING_SECRET,
      body: raw,
      signature: request.headers.get('x-slack-signature'),
      timestamp,
      nowSeconds: Math.floor(now.getTime() / 1000),
      prefix: 'v0='
    }))
  ) {
    return new Response('Unauthorized', { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = record(JSON.parse(new URLSearchParams(raw).get('payload') ?? ''));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const action = record(actions[0]);
  const team = record(payload.team);
  const channel = record(payload.channel);
  const user = record(payload.user);
  const message = record(payload.message);
  const container = record(payload.container);
  const teamId = team.id;
  const channelId = channel.id;
  const userId = user.id;
  const requestTs = message.ts ?? container.message_ts;
  const actionIdentity = action?.action_ts ?? payload.trigger_id;
  if (
    typeof teamId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof userId !== 'string' ||
    typeof requestTs !== 'string' ||
    typeof action.action_id !== 'string' ||
    typeof actionIdentity !== 'string'
  ) {
    return new Response('Bad Request', { status: 400 });
  }
  const identity = `slack:action:${teamId}:${channelId}:${userId}:${action.action_id}:${actionIdentity}`;
  const work: InboundWork = {
    identity,
    requestId: identity,
    kind: 'action',
    text: typeof action.value === 'string' ? action.value : action.action_id,
    actionId: action.action_id,
    ...(typeof action.value === 'string' ? { actionValue: action.value } : {}),
    requestedBy: userId,
    receivedAt: now.toISOString(),
    slack: {
      teamId,
      channelId,
      threadTs: typeof container.thread_ts === 'string' ? container.thread_ts : requestTs,
      requestTs
    }
  };
  return acceptWork(work, env, store);
}

async function githubWebhook(
  request: Request,
  env: Env,
  store: ControlStore,
  slack: SlackPort,
  now: Date
): Promise<Response> {
  const raw = await request.text();
  if (
    !(await verifySignedRequest({
      secret: env.GITHUB_WEBHOOK_SECRET,
      body: raw,
      signature: request.headers.get('x-hub-signature-256'),
      nowSeconds: Math.floor(now.getTime() / 1000),
      prefix: 'sha256='
    }))
  ) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.headers.get('x-github-event') !== 'workflow_run') {
    return new Response('Ignored', { status: 202 });
  }
  const payload = record(JSON.parse(raw));
  const run = record(payload.workflow_run);
  if (typeof run.id !== 'string' && typeof run.id !== 'number') {
    return new Response('Bad Request', { status: 400 });
  }
  const runId = String(run.id);
  const correlation = await store.findByRunId(runId);
  if (!correlation) return new Response('Uncorrelated', { status: 202 });
  const summary: SlackRunSummary = {
    runId,
    status: typeof run.status === 'string' ? run.status : String(payload.action ?? 'updated'),
    ...(typeof run.conclusion === 'string' ? { conclusion: run.conclusion } : {}),
    ...(typeof run.html_url === 'string' ? { htmlUrl: run.html_url } : {}),
    ...(typeof run.artifacts_url === 'string' ? { reportUrl: run.artifacts_url } : {})
  };
  if (correlation.responseTs) {
    await slack.updateResult(correlation, correlation.responseTs, summary);
    await store.markCompleted(correlation.requestId, summary.conclusion ?? summary.status);
  } else {
    const responseTs = await slack.postResult(correlation, summary);
    await store.markCompleted(
      correlation.requestId,
      summary.conclusion ?? summary.status,
      responseTs
    );
  }
  return json(200, { ok: true });
}

export function createWorker(overrides: WorkerDependencies = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const { pathname } = new URL(request.url);
      const now = (overrides.now ?? (() => new Date()))();
      const store = storeService(env, overrides);
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      if (pathname === '/slack/events') return slackEvents(request, env, store, now);
      if (pathname === '/slack/interactions') return slackInteraction(request, env, store, now);
      if (pathname === '/github/webhook') {
        return githubWebhook(request, env, store, slackService(env, overrides), now);
      }
      return new Response('Not Found', { status: 404 });
    },

    async queue(batch: QueueBatch<InboundWork>, env: Env): Promise<void> {
      const store = storeService(env, overrides);
      const classifier = classifierService(env, overrides);
      const github = githubService(env, overrides);
      for (const message of batch.messages) {
        if (!(await store.claim(message.body.requestId))) {
          message.ack();
          continue;
        }
        try {
          const command = await classifier.classify(message.body);
          const dispatched = await github.dispatch(command, message.body.requestId);
          await store.markDispatched(message.body.requestId, command, dispatched.runId);
          message.ack();
        } catch {
          await store.requeue(message.body.requestId);
          message.retry();
        }
      }
    }
  };
}

export default createWorker();
