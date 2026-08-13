import { WorkersAiIntentClassifier, ResilientIntentClassifier } from './classifier.js';
import { handleSlackAction, LINK_ONLY_ACTIONS } from './actions.js';
import { authorizeCommand, externalRoleForUser, isPrivilegedAction } from './authorization.js';
import { GitHubAppClient } from './github.js';
import { verifyCallbackRequest, verifySignedRequest } from './security.js';
import { SlackWebClient } from './slack.js';
import { D1ControlStore } from './store.js';
import { createControlPlaneRedactor } from './privacy.js';
import {
  DEFAULT_EXECUTION_PROFILES,
  DEFAULT_PROJECT_REGISTRY,
  resolveTrustedCommand
} from './project-registry.js';
import type {
  ControlStore,
  Correlation,
  Env,
  GitHubPort,
  InboundWork,
  IntentClassifier,
  SlackPort,
  SlackRunSummary
} from './types.js';
import type { ProjectExecutionProfile, ProjectRegistry } from '@qali/contracts';

interface QueueMessage<T> {
  body: T;
  attempts?: number;
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
  projectRegistry?: ProjectRegistry;
  executionProfiles?: ProjectExecutionProfile[];
}

const csv = (value?: string): Set<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

function stringArray(value: string | undefined, label: string): string[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a JSON string array`);
  }
  return parsed;
}

function redactorService(env: Env): (value: string) => string {
  return createControlPlaneRedactor({
    sensitiveValues: [
      env.SLACK_SIGNING_SECRET,
      env.SLACK_BOT_TOKEN,
      env.GITHUB_WEBHOOK_SECRET,
      env.QALI_CALLBACK_SECRET,
      env.GITHUB_APP_PRIVATE_KEY,
      ...stringArray(env.QALI_SENSITIVE_VALUES_JSON, 'QALI_SENSITIVE_VALUES_JSON')
    ],
    configuredPatterns: stringArray(
      env.QALI_REDACTION_PATTERNS_JSON,
      'QALI_REDACTION_PATTERNS_JSON'
    )
  });
}

const transientQueueFailure = (detail: string): boolean =>
  /\b(?:408|425|429|500|502|503|504)\b|network|timed?\s*out|temporar|rate.?limit|econn/i.test(
    detail
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
  return new ResilientIntentClassifier(new WorkersAiIntentClassifier(env.AI, env.INTENT_MODEL));
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
    externalRole: externalRoleForUser(event.user, env.SLACK_QA_LEAD_USER_IDS),
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
  // URL buttons can still emit interaction payloads; never queue them.
  if (LINK_ONLY_ACTIONS.has(action.action_id)) {
    return json(200, { ok: true });
  }
  const identity = `slack:action:${teamId}:${channelId}:${userId}:${action.action_id}:${actionIdentity}`;
  const externalRole = externalRoleForUser(userId, env.SLACK_QA_LEAD_USER_IDS);
  if (externalRole === 'developer' && isPrivilegedAction(action.action_id)) {
    return new Response('Forbidden', { status: 403 });
  }
  const work: InboundWork = {
    identity,
    requestId: identity,
    kind: 'action',
    text: typeof action.value === 'string' ? action.value : action.action_id,
    actionId: action.action_id,
    ...(typeof action.value === 'string' ? { actionValue: action.value } : {}),
    requestedBy: userId,
    externalRole,
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

function commandMeta(correlation: Correlation): { intent?: string; projectId?: string } {
  if (!correlation.commandJson) return {};
  try {
    const parsed = JSON.parse(correlation.commandJson) as {
      intent?: unknown;
      project?: { id?: unknown };
    };
    return {
      ...(typeof parsed.intent === 'string' ? { intent: parsed.intent } : {}),
      ...(typeof parsed.project?.id === 'string' ? { projectId: parsed.project.id } : {})
    };
  } catch {
    return {};
  }
}

async function applySlackSummary(input: {
  store: ControlStore;
  slack: SlackPort;
  correlation: Correlation;
  summary: SlackRunSummary;
}): Promise<Response> {
  const { store, slack, correlation, summary } = input;
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
  const reportedCounts = record(payload.qali_summary);
  const counts =
    typeof reportedCounts.total === 'number' &&
    typeof reportedCounts.passed === 'number' &&
    typeof reportedCounts.failed === 'number' &&
    typeof reportedCounts.skipped === 'number'
      ? {
          total: reportedCounts.total,
          passed: reportedCounts.passed,
          failed: reportedCounts.failed,
          skipped: reportedCounts.skipped
        }
      : undefined;
  const meta = commandMeta(correlation);
  const summary: SlackRunSummary = {
    runId,
    status: typeof run.status === 'string' ? run.status : String(payload.action ?? 'updated'),
    ...(typeof run.conclusion === 'string' ? { conclusion: run.conclusion } : {}),
    ...(typeof run.html_url === 'string' ? { htmlUrl: run.html_url } : {}),
    ...meta,
    ...(counts ? { counts } : {})
  };
  const terminal = Boolean(summary.conclusion) || summary.status === 'completed';
  const finalized = [
    'passed',
    'failed',
    'success',
    'failure',
    'cancelled',
    'canceled',
    'timed_out'
  ].includes(correlation.status.toLowerCase());
  // Prefer /github/run-summary (pass/fail counts). Never clobber a richer Slack card.
  if (!counts && correlation.responseTs && (finalized || !terminal)) {
    if (terminal) {
      await store.markCompleted(correlation.requestId, summary.conclusion ?? summary.status);
    }
    return json(200, { ok: true, skipped: 'preserve-slack' });
  }
  return applySlackSummary({ store, slack, correlation, summary });
}

async function githubRunSummary(
  request: Request,
  env: Env,
  store: ControlStore,
  slack: SlackPort,
  now: Date
): Promise<Response> {
  const raw = await request.text();
  const redact = redactorService(env);
  const authentication = await verifyCallbackRequest({
    secret: env.QALI_CALLBACK_SECRET,
    body: raw,
    signature: request.headers.get('x-qali-signature'),
    timestamp: request.headers.get('x-qali-timestamp'),
    nonce: request.headers.get('x-qali-nonce'),
    nowSeconds: Math.floor(now.getTime() / 1000)
  });
  if (!authentication.valid) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!(await store.acceptCallback(authentication.identity, now.toISOString()))) {
    return json(200, { ok: true, skipped: 'replay' });
  }
  let payload: Record<string, unknown>;
  try {
    payload = record(JSON.parse(raw));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : undefined;
  const runId = payload.runId !== undefined ? String(payload.runId) : undefined;
  const correlation =
    (requestId ? await store.findByRequestId(requestId) : null) ??
    (runId ? await store.findByRunId(runId) : null);
  if (!correlation) return new Response('Uncorrelated', { status: 404 });
  const counts = record(payload.counts);
  const hasCounts =
    typeof counts.total === 'number' &&
    typeof counts.passed === 'number' &&
    typeof counts.failed === 'number' &&
    typeof counts.skipped === 'number';
  const meta = commandMeta(correlation);
  const errors = Array.isArray(payload.errors)
    ? payload.errors
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => redact(entry))
    : undefined;
  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => redact(entry))
    : undefined;
  const summary: SlackRunSummary = {
    runId: runId ?? correlation.runId ?? correlation.requestId,
    status: typeof payload.status === 'string' ? payload.status : correlation.status,
    ...(typeof payload.htmlUrl === 'string' ? { htmlUrl: payload.htmlUrl } : {}),
    ...(typeof payload.intent === 'string'
      ? { intent: payload.intent }
      : meta.intent
        ? { intent: meta.intent }
        : {}),
    ...(typeof payload.projectId === 'string'
      ? { projectId: payload.projectId }
      : meta.projectId
        ? { projectId: meta.projectId }
        : {}),
    ...(typeof payload.suiteLabel === 'string' ? { suiteLabel: payload.suiteLabel } : {}),
    ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
    ...(errors && errors.length ? { errors } : {}),
    ...(evidence && evidence.length ? { evidence } : {}),
    ...(hasCounts
      ? {
          counts: {
            total: counts.total as number,
            passed: counts.passed as number,
            failed: counts.failed as number,
            skipped: counts.skipped as number
          }
        }
      : {})
  };
  return applySlackSummary({ store, slack, correlation, summary });
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
      if (pathname === '/github/run-summary') {
        return githubRunSummary(request, env, store, slackService(env, overrides), now);
      }
      return new Response('Not Found', { status: 404 });
    },

    async queue(batch: QueueBatch<InboundWork>, env: Env): Promise<void> {
      const store = storeService(env, overrides);
      const classifier = classifierService(env, overrides);
      const github = githubService(env, overrides);
      const slack = slackService(env, overrides);
      for (const message of batch.messages) {
        if (!(await store.claim(message.body.requestId))) {
          message.ack();
          continue;
        }
        let dispatchAttempted = false;
        let dispatchSucceeded = false;
        try {
          if (message.body.kind === 'action') {
            dispatchAttempted = true;
            await handleSlackAction({
              work: message.body,
              store,
              github,
              slack,
              projectRegistry: overrides.projectRegistry ?? DEFAULT_PROJECT_REGISTRY,
              executionProfiles: overrides.executionProfiles ?? DEFAULT_EXECUTION_PROFILES
            });
            message.ack();
            continue;
          }
          try {
            await slack.postThreadNotice({
              channelId: message.body.slack.channelId,
              threadTs: message.body.slack.threadTs,
              text: 'Working on it…'
            });
          } catch (ackError) {
            console.error(
              'qali.queue.ack_failed',
              ackError instanceof Error ? ackError.message : String(ackError)
            );
          }
          const classification = await classifier.classify(message.body);
          const command = resolveTrustedCommand(
            classification,
            message.body,
            overrides.projectRegistry ?? DEFAULT_PROJECT_REGISTRY,
            overrides.executionProfiles ?? DEFAULT_EXECUTION_PROFILES
          );
          const authorization = authorizeCommand(command);
          if (!authorization.allowed) {
            const reason = authorization.reason;
            await slack.postThreadNotice({
              channelId: message.body.slack.channelId,
              threadTs: message.body.slack.threadTs,
              text: `Qali rejected this request: ${reason}`
            });
            await store.markCompleted(message.body.requestId, 'rejected', undefined, reason);
            message.ack();
            continue;
          }
          dispatchAttempted = true;
          const dispatched = await github.dispatch(command, message.body.requestId);
          dispatchSucceeded = true;
          await store.markDispatched(message.body.requestId, command, dispatched.runId);
          await slack.postThreadNotice({
            channelId: message.body.slack.channelId,
            threadTs: message.body.slack.threadTs,
            text: dispatched.htmlUrl
              ? `Started: ${dispatched.htmlUrl}`
              : `Started \`${command.intent}\`.`
          });
          message.ack();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const transient = transientQueueFailure(detail);
          console.error('qali.queue.failed', {
            requestId: message.body.requestId,
            detail
          });
          if (transient && !dispatchAttempted && (message.attempts ?? 1) < 3) {
            await store.requeue(message.body.requestId);
            message.retry();
            continue;
          }
          if (dispatchSucceeded) {
            const correlation = await store.findByRequestId(message.body.requestId);
            if (correlation?.status !== 'dispatched' && !correlation?.runId) {
              await store.markCompleted(
                message.body.requestId,
                'dispatch-uncertain',
                undefined,
                detail.slice(0, 1000)
              );
            }
            message.ack();
            continue;
          }
          try {
            await slack.postThreadNotice({
              channelId: message.body.slack.channelId,
              threadTs: message.body.slack.threadTs,
              text: transient
                ? `Qali stopped retrying this request: ${detail.slice(0, 400)}`
                : `Qali could not start this request: ${detail.slice(0, 400)}`
            });
          } catch (notifyError) {
            console.error(
              'qali.queue.notify_failed',
              notifyError instanceof Error ? notifyError.message : String(notifyError)
            );
          }
          await store.markCompleted(
            message.body.requestId,
            transient ? 'dead-lettered' : 'failed',
            undefined,
            detail.slice(0, 1000)
          );
          message.ack();
        }
      }
    }
  };
}

export default createWorker();
