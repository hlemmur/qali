import {
  NormalizedCommandSchema,
  type NormalizedCommand,
  type ProjectExecutionProfile,
  type ProjectRegistry
} from '@qali/contracts';
import { resolveTrustedCommand } from '@qali/project-config';
import { DEFAULT_EXECUTION_PROFILES, DEFAULT_PROJECT_REGISTRY } from './project-registry.js';
import type {
  ControlStore,
  Correlation,
  GitHubPort,
  InboundWork,
  SlackPort,
  SlackRunSummary
} from './types.js';

/** Link buttons open URLs in the client; never enqueue work or post thread spam. */
export const LINK_ONLY_ACTIONS = new Set([
  'open_run_url',
  'open_report',
  'open_spec',
  'run_details'
]);

const SUMMARY_ACTIONS = new Set(['expand_run_details', 'collapse_run_details']);

function parseActionValue(raw?: string): {
  requestId?: string;
  runId?: string;
  summary?: SlackRunSummary;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as {
      requestId?: unknown;
      runId?: unknown;
      summary?: SlackRunSummary;
    };
    return {
      ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
      ...(typeof parsed.runId === 'string' ? { runId: parsed.runId } : {}),
      ...(parsed.summary && typeof parsed.summary === 'object' ? { summary: parsed.summary } : {})
    };
  } catch {
    return { runId: raw };
  }
}

async function resolveCorrelation(
  store: ControlStore,
  value: { requestId?: string; runId?: string }
): Promise<Correlation | null> {
  if (value.requestId) {
    const byRequest = await store.findByRequestId(value.requestId);
    if (byRequest) return byRequest;
  }
  if (value.runId) return store.findByRunId(value.runId);
  return null;
}

function rebuildCommand(
  correlation: Correlation,
  work: InboundWork,
  intent: NormalizedCommand['intent'],
  registry: ProjectRegistry,
  profiles: readonly ProjectExecutionProfile[]
): NormalizedCommand {
  let projectId = registry.projects[0]?.id ?? 'sauce-demo';
  let focus: Record<string, unknown> = {
    sourceRequestId: correlation.requestId,
    ...(correlation.runId ? { sourceRunId: correlation.runId } : {})
  };
  if (correlation.commandJson) {
    const stored = NormalizedCommandSchema.parse(JSON.parse(correlation.commandJson));
    projectId = stored.project.id;
    focus = {
      ...stored.parameters,
      sourceRequestId: correlation.requestId,
      ...(correlation.runId ? { sourceRunId: correlation.runId } : {})
    };
  }
  return resolveTrustedCommand(
    { intent, projectId, focus },
    {
      requestedBy: work.requestedBy,
      externalRole: work.externalRole,
      receivedAt: work.receivedAt,
      slack: work.slack
    },
    registry,
    profiles
  );
}

function summaryFromAction(
  value: { runId?: string; summary?: SlackRunSummary },
  correlation: Correlation | null,
  expanded: boolean
): SlackRunSummary {
  if (value.summary) {
    return { ...value.summary, expanded };
  }
  return {
    runId: value.runId ?? correlation?.runId ?? 'unknown',
    status: correlation?.status ?? 'unknown',
    expanded
  };
}

/** Handle Slack block actions without free-form classification. */
export async function handleSlackAction(input: {
  work: InboundWork;
  store: ControlStore;
  github: GitHubPort;
  slack: SlackPort;
  projectRegistry?: ProjectRegistry;
  executionProfiles?: readonly ProjectExecutionProfile[];
}): Promise<void> {
  const { work, store, github, slack } = input;
  const registry = input.projectRegistry ?? DEFAULT_PROJECT_REGISTRY;
  const profiles = input.executionProfiles ?? DEFAULT_EXECUTION_PROFILES;
  const actionId = work.actionId ?? '';
  const value = parseActionValue(work.actionValue ?? work.text);

  if (LINK_ONLY_ACTIONS.has(actionId)) {
    await store.markCompleted(work.requestId, 'action-ignored');
    return;
  }

  if (SUMMARY_ACTIONS.has(actionId)) {
    const correlation = await resolveCorrelation(store, value);
    if (!correlation?.responseTs && !work.slack.requestTs) {
      throw new Error('No result message to expand');
    }
    const summary = summaryFromAction(value, correlation, actionId === 'expand_run_details');
    const responseTs = correlation?.responseTs ?? work.slack.requestTs;
    const target =
      correlation ??
      ({
        requestId: value.requestId ?? work.requestId,
        status: summary.status,
        createdAt: work.receivedAt,
        updatedAt: work.receivedAt,
        teamId: work.slack.teamId,
        channelId: work.slack.channelId,
        userId: work.requestedBy,
        threadTs: work.slack.threadTs,
        requestTs: work.slack.requestTs,
        responseTs
      } satisfies Correlation);
    await slack.updateResult(target, responseTs, summary);
    await store.markCompleted(work.requestId, 'action-handled');
    return;
  }

  if (actionId === 'retract_generated_tests') {
    const correlation = await resolveCorrelation(store, value);
    if (!correlation) {
      throw new Error(`No correlated run found for ${actionId}`);
    }
    const baseCommand = rebuildCommand(
      correlation,
      work,
      'generate-test-suite',
      registry,
      profiles
    );
    const command = {
      ...baseCommand,
      parameters: {
        ...baseCommand.parameters,
        retractGeneratedTests: true
      }
    };
    const childRequestId = `retract-${Date.now().toString(36)}`;
    const childWork: InboundWork = {
      ...work,
      identity: `child:${childRequestId}`,
      requestId: childRequestId
    };
    await store.accept(childWork);
    await store.claim(childRequestId);
    await slack.postThreadNotice({
      channelId: work.slack.channelId,
      threadTs: work.slack.threadTs,
      text: 'Retracting the generated tests…'
    });
    const dispatched = await github.dispatch(command, childRequestId);
    await store.markDispatched(childRequestId, command, dispatched.runId);
    await store.markCompleted(work.requestId, 'action-handled');
    await slack.postThreadNotice({
      channelId: work.slack.channelId,
      threadTs: work.slack.threadTs,
      text: dispatched.htmlUrl ? `Started: ${dispatched.htmlUrl}` : 'Started a retract run.'
    });
    return;
  }

  if (actionId === 'rerun_workflow' || actionId === 'triage_failures') {
    const correlation = await resolveCorrelation(store, value);
    if (!correlation) {
      throw new Error(`No correlated run found for ${actionId}`);
    }
    const intent: NormalizedCommand['intent'] =
      actionId === 'triage_failures'
        ? 'triage-failure'
        : ((correlation.workflowId as NormalizedCommand['intent'] | undefined) ?? 'run-test-suite');
    const command = rebuildCommand(correlation, work, intent, registry, profiles);
    const childRequestId = `${actionId === 'triage_failures' ? 'triage' : 'rerun'}-${Date.now().toString(36)}`;
    const childWork: InboundWork = {
      ...work,
      identity: `child:${childRequestId}`,
      requestId: childRequestId
    };
    await store.accept(childWork);
    await store.claim(childRequestId);
    const label = actionId === 'triage_failures' ? 'Starting triage…' : 'Rerunning…';
    await slack.postThreadNotice({
      channelId: work.slack.channelId,
      threadTs: work.slack.threadTs,
      text: label
    });
    const dispatched = await github.dispatch(command, childRequestId);
    await store.markDispatched(childRequestId, command, dispatched.runId);
    await store.markCompleted(work.requestId, 'action-handled');
    await slack.postThreadNotice({
      channelId: work.slack.channelId,
      threadTs: work.slack.threadTs,
      text: dispatched.htmlUrl ? `Started: ${dispatched.htmlUrl}` : 'Started a new run.'
    });
    return;
  }

  throw new Error(`Unsupported Slack action: ${actionId || 'unknown'}`);
}
