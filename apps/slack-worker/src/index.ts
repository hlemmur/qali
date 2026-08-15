import { WorkersAiIntentClassifier, ResilientIntentClassifier } from './classifier.js';
import { handleSlackAction, LINK_ONLY_ACTIONS } from './actions.js';
import { authorizeCommand, externalRoleForUser, isPrivilegedAction } from './authorization.js';
import { GitHubAppClient } from './github.js';
import { applyOnboardTarget, parseOnboardTarget } from './onboard-target.js';
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
import type { ProjectExecutionProfile, ProjectRegistry, QualitySnapshot } from '@qali/contracts';
import {
  dispatchedWorkPhase,
  formatWorkAcknowledgement,
  initialWorkPhase
} from './acknowledgement.js';
import { homeItemsFromCorrelations, renderAppHome } from './home.js';
import { uploadHostedReport, serveHostedReport } from './hosted-reports.js';
import {
  formatQualityQueryAnswer,
  mergeQualitySnapshot,
  parseQualitySnapshot
} from './quality-query.js';

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

async function subjectHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Rate limit must be positive');
  return parsed;
}

const transientQueueFailure = (detail: string): boolean =>
  /\b(?:408|425|429|500|502|503|504)\b|network|timed?\s*out|temporar|rate.?limit|econn/i.test(
    detail
  );

function channelAllowed(env: Env, channelId: string): boolean {
  const productChannels = csv(env.SLACK_ALLOWED_CHANNEL_IDS);
  if (productChannels.size === 0) return true;
  return productChannels.has(channelId) || csv(env.SLACK_OPS_CHANNEL_IDS).has(channelId);
}

function roleForSlackUser(env: Env, userId: string, channelId: string) {
  return externalRoleForUser(userId, {
    ...(env.SLACK_QA_LEAD_USER_IDS ? { breakGlassUserIds: env.SLACK_QA_LEAD_USER_IDS } : {}),
    ...(env.SLACK_OPS_CHANNEL_IDS ? { opsChannelIds: env.SLACK_OPS_CHANNEL_IDS } : {}),
    channelId
  });
}

function allowed(env: Env, teamId: string, channelId: string, userId: string): boolean {
  const checks: Array<[Set<string>, string]> = [
    [csv(env.SLACK_ALLOWED_TEAM_IDS), teamId],
    [csv(env.SLACK_ALLOWED_USER_IDS), userId]
  ];
  return (
    channelAllowed(env, channelId) &&
    checks.every(([allowlist, value]) => allowlist.size === 0 || allowlist.has(value))
  );
}

function allowedHome(env: Env, teamId: string, userId: string): boolean {
  const checks: Array<[Set<string>, string]> = [
    [csv(env.SLACK_ALLOWED_TEAM_IDS), teamId],
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
    await store.recordSecurityDenial({
      occurredAt: work.receivedAt,
      reasonCode: 'intake_allowlist',
      requestKind: work.kind
    });
    return new Response('Forbidden', { status: 403 });
  }
  const occurredAt = new Date(work.receivedAt);
  const rate = await store.consumeRateLimit({
    scope: 'user',
    subjectHash: await subjectHash(`${work.slack.teamId}:${work.requestedBy}`),
    eventId: `user:${work.identity}`,
    occurredAt: occurredAt.toISOString(),
    windowStart: new Date(occurredAt.getTime() - 60_000).toISOString(),
    limit: positiveInteger(env.QALI_USER_RATE_LIMIT_PER_MINUTE, 60)
  });
  if (rate === 'limited') {
    await store.recordSecurityDenial({
      occurredAt: work.receivedAt,
      reasonCode: 'rate_limit_user',
      requestKind: work.kind
    });
    return new Response('Too Many Requests', { status: 429 });
  }
  if (await store.accept(work)) await env.INBOUND_QUEUE.send(work);
  return json(200, { ok: true });
}

async function slackEvents(
  request: Request,
  env: Env,
  store: ControlStore,
  slack: SlackPort,
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
  if (event?.type === 'app_home_opened' && typeof event.user === 'string') {
    const teamId = typeof payload.team_id === 'string' ? payload.team_id : '';
    if (!allowedHome(env, teamId, event.user)) {
      return new Response('Ignored', { status: 200 });
    }
    if (slack.publishHome) {
      const items = homeItemsFromCorrelations(await store.listWorkForUser(event.user));
      await slack.publishHome(event.user, renderAppHome(items));
    }
    return new Response('OK', { status: 200 });
  }
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
    externalRole: roleForSlackUser(env, event.user, event.channel),
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

function interactionFields(payload: Record<string, unknown>): {
  actionId: string;
  actionIdentity: string;
  text: string;
  actionValue?: string;
  requestTs: string;
  threadTs: string;
} | null {
  const message = record(payload.message);
  const container = record(payload.container);
  const requestTs =
    (typeof message.ts === 'string' && message.ts) ||
    (typeof container.message_ts === 'string' && container.message_ts) ||
    (typeof payload.message_ts === 'string' && payload.message_ts) ||
    undefined;
  if (typeof requestTs !== 'string') return null;

  if (payload.type === 'message_action') {
    const actionId = payload.callback_id;
    const actionIdentity = payload.trigger_id;
    if (typeof actionId !== 'string' || typeof actionIdentity !== 'string') return null;
    return {
      actionId,
      actionIdentity,
      text: typeof message.text === 'string' ? message.text : actionId,
      requestTs,
      threadTs: typeof message.thread_ts === 'string' ? message.thread_ts : requestTs
    };
  }

  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const action = record(actions[0]);
  const actionIdentity = action.action_ts ?? payload.trigger_id;
  if (typeof action.action_id !== 'string' || typeof actionIdentity !== 'string') return null;
  return {
    actionId: action.action_id,
    actionIdentity,
    text: typeof action.value === 'string' ? action.value : action.action_id,
    ...(typeof action.value === 'string' ? { actionValue: action.value } : {}),
    requestTs,
    threadTs: typeof container.thread_ts === 'string' ? container.thread_ts : requestTs
  };
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
  const fields = interactionFields(payload);
  const team = record(payload.team);
  const channel = record(payload.channel);
  const user = record(payload.user);
  const teamId = team.id;
  const channelId = channel.id;
  const userId = user.id;
  if (
    !fields ||
    typeof teamId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof userId !== 'string'
  ) {
    return new Response('Bad Request', { status: 400 });
  }
  // URL buttons can still emit interaction payloads; never queue them.
  if (LINK_ONLY_ACTIONS.has(fields.actionId)) {
    return json(200, { ok: true });
  }
  const identity = `slack:action:${teamId}:${channelId}:${userId}:${fields.actionId}:${fields.actionIdentity}`;
  const externalRole = roleForSlackUser(env, userId, channelId);
  if (externalRole === 'developer' && isPrivilegedAction(fields.actionId)) {
    await store.recordSecurityDenial({
      occurredAt: now.toISOString(),
      reasonCode: 'privileged_action',
      requestKind: 'action'
    });
    return new Response('Forbidden', { status: 403 });
  }
  const work: InboundWork = {
    identity,
    requestId: identity,
    kind: 'action',
    text: fields.text,
    actionId: fields.actionId,
    ...(fields.actionValue ? { actionValue: fields.actionValue } : {}),
    requestedBy: userId,
    externalRole,
    receivedAt: now.toISOString(),
    slack: {
      teamId,
      channelId,
      threadTs: fields.threadTs,
      requestTs: fields.requestTs
    }
  };
  return acceptWork(work, env, store);
}

async function threadContextFor(
  store: ControlStore,
  work: InboundWork
): Promise<InboundWork['threadContext'] | undefined> {
  if (work.slack.threadTs === work.slack.requestTs) return undefined;
  const prior = await store.findLatestByThread({
    teamId: work.slack.teamId,
    channelId: work.slack.channelId,
    threadTs: work.slack.threadTs
  });
  if (!prior) return undefined;
  let priorIntent = prior.workflowId;
  let priorFeature: string | undefined;
  if (prior.commandJson) {
    try {
      const stored = JSON.parse(prior.commandJson) as {
        intent?: unknown;
        parameters?: Record<string, unknown>;
      };
      if (typeof stored.intent === 'string') priorIntent = stored.intent;
      if (typeof stored.parameters?.feature === 'string') {
        priorFeature = stored.parameters.feature;
      }
    } catch {
      /* ignore malformed stored command */
    }
  }
  return {
    ...(priorIntent ? { priorIntent } : {}),
    ...(priorFeature ? { priorFeature } : {}),
    requestId: prior.requestId
  };
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

async function persistQualitySnapshot(
  store: ControlStore,
  correlation: Correlation,
  summary: SlackRunSummary
): Promise<QualitySnapshot | null> {
  const projectId = summary.projectId ?? commandMeta(correlation).projectId;
  if (!projectId) return null;
  const existing = await store.getQualitySnapshot(projectId);
  const lastRun = {
    intent: summary.intent ?? commandMeta(correlation).intent ?? 'unknown',
    requestId: correlation.requestId,
    finishedAt: new Date().toISOString(),
    status: summary.conclusion ?? summary.status,
    ...(summary.counts ? { counts: summary.counts } : {}),
    ...(summary.stages ? { stages: summary.stages } : {})
  };
  const explorationPatch = summary.exploration
    ? {
        ...(summary.exploration.findings?.length
          ? { knownIssues: summary.exploration.findings }
          : {}),
        ...(summary.exploration.questions?.length
          ? { openQuestions: summary.exploration.questions }
          : {}),
        ...(summary.exploration.assumptions?.length
          ? { expectedResults: summary.exploration.assumptions }
          : {})
      }
    : {};
  const snapshot = mergeQualitySnapshot(existing, {
    ...(summary.qualitySnapshot ?? {}),
    ...explorationPatch,
    projectId,
    updatedAt: summary.qualitySnapshot?.updatedAt ?? new Date().toISOString(),
    lastRun: summary.qualitySnapshot?.lastRun ?? lastRun
  });
  await store.upsertQualitySnapshot(snapshot);
  return snapshot;
}

async function applySlackSummary(input: {
  store: ControlStore;
  slack: SlackPort;
  correlation: Correlation;
  summary: SlackRunSummary;
}): Promise<Response> {
  const { store, slack, correlation, summary } = input;
  const snapshot = await persistQualitySnapshot(store, correlation, summary);
  const intent = summary.intent ?? commandMeta(correlation).intent;
  if (intent === 'query-project' && snapshot) {
    let focus: Record<string, unknown> = {};
    if (correlation.commandJson) {
      try {
        focus =
          (JSON.parse(correlation.commandJson) as { parameters?: Record<string, unknown> })
            .parameters ?? {};
      } catch {
        /* keep empty focus */
      }
    }
    await slack.postThreadNotice({
      channelId: correlation.channelId,
      threadTs: correlation.threadTs,
      text: formatQualityQueryAnswer(snapshot, focus)
    });
    await store.markCompleted(correlation.requestId, 'answered');
    return json(200, { ok: true });
  }
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
  const exploration =
    payload.exploration &&
    typeof payload.exploration === 'object' &&
    !Array.isArray(payload.exploration)
      ? (payload.exploration as NonNullable<SlackRunSummary['exploration']>)
      : undefined;
  const generation =
    payload.generation &&
    typeof payload.generation === 'object' &&
    !Array.isArray(payload.generation)
      ? (payload.generation as NonNullable<SlackRunSummary['generation']>)
      : undefined;
  const correlation =
    (requestId ? await store.findByRequestId(requestId) : null) ??
    (runId ? await store.findByRunId(runId) : null);
  const scheduledHeartbeat = Boolean(requestId?.startsWith('scheduled-'));
  if (!correlation && scheduledHeartbeat) {
    const channelId = DEFAULT_PROJECT_REGISTRY.projects[0]?.allowedSlack.channelIds[0];
    const prior = channelId ? await store.findLatestInChannel(channelId) : null;
    if (prior) {
      await slack.postResult(
        { ...prior, requestId: requestId ?? prior.requestId, ...(runId ? { runId } : {}) },
        {
          runId: runId ?? prior.runId ?? 'scheduled',
          status: typeof payload.status === 'string' ? payload.status : 'passed',
          intent: typeof payload.intent === 'string' ? payload.intent : 'quality-pulse',
          ...(typeof payload.reportUrl === 'string' ? { reportUrl: payload.reportUrl } : {}),
          ...(exploration ? { exploration } : {}),
          ...(generation ? { generation } : {})
        }
      );
      return json(200, { ok: true, heartbeat: true });
    }
  }
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
  const rawStages = record(payload.stages);
  const parsedStages = ['execution', 'validation', 'publication'].reduce<SlackRunSummary['stages']>(
    (stages, key) => {
      const value = rawStages[key];
      if (typeof value !== 'string' || !value.trim()) return stages;
      return { ...stages, [key]: value };
    },
    undefined
  );
  const qualitySnapshot = parseQualitySnapshot(payload.qualitySnapshot);
  const generatedTestsRaw = record(payload.generatedTests);
  const generatedTests =
    typeof generatedTestsRaw.count === 'number' && generatedTestsRaw.count > 0
      ? {
          count: generatedTestsRaw.count,
          ...(typeof generatedTestsRaw.area === 'string' ? { area: generatedTestsRaw.area } : {}),
          ...(Array.isArray(generatedTestsRaw.titles)
            ? {
                titles: generatedTestsRaw.titles.filter(
                  (title): title is string => typeof title === 'string'
                )
              }
            : {})
        }
      : undefined;
  const summary: SlackRunSummary = {
    runId: runId ?? correlation.runId ?? correlation.requestId,
    status: typeof payload.status === 'string' ? payload.status : correlation.status,
    ...(typeof payload.htmlUrl === 'string' ? { htmlUrl: payload.htmlUrl } : {}),
    ...(typeof payload.reportUrl === 'string' ? { reportUrl: payload.reportUrl } : {}),
    ...(typeof payload.specUrl === 'string' ? { specUrl: payload.specUrl } : {}),
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
      : {}),
    ...(parsedStages ? { stages: parsedStages } : {}),
    ...(qualitySnapshot ? { qualitySnapshot } : {}),
    ...(generatedTests ? { generatedTests } : {}),
    ...(exploration ? { exploration } : {}),
    ...(generation ? { generation } : {})
  };
  try {
    return await applySlackSummary({ store, slack, correlation, summary });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Response(detail.slice(0, 400), { status: 502 });
  }
}

export function createWorker(overrides: WorkerDependencies = {}) {
  return {
    async scheduled(_controller: unknown, env: Env): Promise<void> {
      const now = (overrides.now ?? (() => new Date()))();
      const dayMs = 24 * 60 * 60 * 1_000;
      const controlDays = positiveInteger(env.QALI_CONTROL_RETENTION_DAYS, 30);
      const securityDays = positiveInteger(env.QALI_SECURITY_RETENTION_DAYS, 14);
      await storeService(env, overrides).purgeExpired({
        controlBefore: new Date(now.getTime() - controlDays * dayMs).toISOString(),
        securityBefore: new Date(now.getTime() - securityDays * dayMs).toISOString()
      });
    },

    async fetch(request: Request, env: Env): Promise<Response> {
      const { pathname } = new URL(request.url);
      const now = (overrides.now ?? (() => new Date()))();
      const store = storeService(env, overrides);
      if (request.method === 'GET' && pathname.startsWith('/reports/')) {
        return serveHostedReport(request, env, now);
      }
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      if (pathname === '/slack/events') {
        return slackEvents(request, env, store, slackService(env, overrides), now);
      }
      if (pathname === '/slack/interactions') return slackInteraction(request, env, store, now);
      if (pathname === '/github/webhook') {
        return githubWebhook(request, env, store, slackService(env, overrides), now);
      }
      if (pathname === '/github/run-summary') {
        return githubRunSummary(request, env, store, slackService(env, overrides), now);
      }
      if (pathname === '/github/report') {
        return uploadHostedReport(request, env, store, now);
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
        let statusTs: string | undefined;
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
          const onboard = parseOnboardTarget(message.body.text);
          const threadContext = await threadContextFor(store, message.body);
          const classifyWork = {
            ...(onboard.ok && onboard.credentials
              ? { ...message.body, text: onboard.sanitizedText }
              : message.body),
            ...(threadContext ? { threadContext } : {})
          };
          const classification = applyOnboardTarget(
            await classifier.classify(classifyWork),
            classifyWork.text
          );
          const resolved = resolveTrustedCommand(
            classification,
            message.body,
            overrides.projectRegistry ?? DEFAULT_PROJECT_REGISTRY,
            overrides.executionProfiles ?? DEFAULT_EXECUTION_PROFILES,
            { opsChannelIds: [...csv(env.SLACK_OPS_CHANNEL_IDS)] }
          );
          const command = {
            ...resolved,
            parameters: {
              ...resolved.parameters,
              generationRequestId: message.body.requestId
            } as Record<string, unknown>
          };
          const executionProfiles = overrides.executionProfiles ?? DEFAULT_EXECUTION_PROFILES;
          const executionProfile = executionProfiles.find(
            (profile) => profile.id === command.project.executionProfileId
          );
          const occurredAt = new Date(message.body.receivedAt);
          const projectRate = await store.consumeRateLimit({
            scope: 'project',
            subjectHash: await subjectHash(command.project.id),
            eventId: `project:${message.body.requestId}`,
            occurredAt: occurredAt.toISOString(),
            windowStart: new Date(occurredAt.getTime() - 60_000).toISOString(),
            limit: executionProfile?.rate.maxActionsPerMinute ?? 60
          });
          if (projectRate === 'limited') {
            const reason = 'Project rate limit exceeded';
            await store.recordSecurityDenial({
              occurredAt: message.body.receivedAt,
              reasonCode: 'rate_limit_project',
              requestKind: message.body.kind
            });
            await slack.postThreadNotice({
              channelId: message.body.slack.channelId,
              threadTs: message.body.slack.threadTs,
              text: `Qali rejected this request: ${reason}`
            });
            await store.markCompleted(message.body.requestId, 'rejected', undefined, reason);
            message.ack();
            continue;
          }
          const authorization = authorizeCommand(command);
          if (!authorization.allowed) {
            const reason = authorization.reason;
            await store.recordSecurityDenial({
              occurredAt: message.body.receivedAt,
              reasonCode: 'command_authorization',
              requestKind: message.body.kind
            });
            await slack.postThreadNotice({
              channelId: message.body.slack.channelId,
              threadTs: message.body.slack.threadTs,
              text: `Qali rejected this request: ${reason}`
            });
            await store.markCompleted(message.body.requestId, 'rejected', undefined, reason);
            message.ack();
            continue;
          }
          if (command.intent === 'query-project') {
            const snapshot = await store.getQualitySnapshot(command.project.id);
            if (snapshot) {
              await slack.postThreadNotice({
                channelId: message.body.slack.channelId,
                threadTs: message.body.slack.threadTs,
                text: formatQualityQueryAnswer(snapshot, command.parameters)
              });
              await store.markCompleted(message.body.requestId, 'answered');
              message.ack();
              continue;
            }
          }
          try {
            statusTs = await slack.postThreadNotice({
              channelId: message.body.slack.channelId,
              threadTs: message.body.slack.threadTs,
              text: formatWorkAcknowledgement(command, initialWorkPhase(command.intent))
            });
          } catch (ackError) {
            console.error(
              'qali.queue.ack_failed',
              ackError instanceof Error ? ackError.message : String(ackError)
            );
          }
          dispatchAttempted = true;
          if (
            command.intent === 'onboard-project' &&
            github.provisionProjectEnvironment &&
            typeof command.parameters.targetUrl === 'string' &&
            typeof command.parameters.origin === 'string'
          ) {
            const credentialsJson =
              onboard.ok && onboard.credentials
                ? JSON.stringify({ [onboard.credentials.name]: onboard.credentials.password })
                : '{}';
            const testDataJson =
              onboard.ok && onboard.credentials?.username
                ? JSON.stringify({ username: onboard.credentials.username })
                : '{}';
            await github.provisionProjectEnvironment({
              environment: command.project.environment ?? `qali-${command.project.id}`,
              baseUrl: command.parameters.targetUrl,
              allowedOrigins: [command.parameters.origin],
              credentialsJson,
              testDataJson
            });
          }
          const dispatched = await github.dispatch(command, message.body.requestId);
          dispatchSucceeded = true;
          await store.markDispatched(message.body.requestId, command, dispatched.runId);
          if (command.intent !== 'query-project') {
            const progress = formatWorkAcknowledgement(
              command,
              dispatchedWorkPhase(command.intent),
              0
            );
            if (statusTs && slack.updateThreadNotice) {
              await slack.updateThreadNotice({
                channelId: message.body.slack.channelId,
                ts: statusTs,
                text: progress
              });
            } else {
              await slack.postThreadNotice({
                channelId: message.body.slack.channelId,
                threadTs: message.body.slack.threadTs,
                text: progress
              });
            }
          }
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
