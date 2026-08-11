import { NormalizedCommandSchema, type NormalizedCommand } from '@qali/contracts';
import { renderSlackRunDetails } from '@qali/reporting';
import type { ControlStore, Correlation, GitHubPort, InboundWork, SlackPort } from './types.js';

const LINK_ONLY_ACTIONS = new Set(['open_run_url', 'open_report', 'run_details']);

function parseActionValue(raw?: string): { requestId?: string; runId?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { requestId?: unknown; runId?: unknown };
    return {
      ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
      ...(typeof parsed.runId === 'string' ? { runId: parsed.runId } : {})
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
  intent: NormalizedCommand['intent']
): NormalizedCommand {
  if (correlation.commandJson) {
    const stored = NormalizedCommandSchema.parse(JSON.parse(correlation.commandJson));
    return NormalizedCommandSchema.parse({
      ...stored,
      intent,
      requestedBy: work.requestedBy,
      externalRole: work.externalRole,
      receivedAt: work.receivedAt,
      slack: work.slack
    });
  }
  return NormalizedCommandSchema.parse({
    intent,
    project: { id: '_demo', root: 'projects/_demo' },
    parameters: {
      sourceRequestId: correlation.requestId,
      ...(correlation.runId ? { sourceRunId: correlation.runId } : {})
    },
    requestedBy: work.requestedBy,
    externalRole: work.externalRole,
    receivedAt: work.receivedAt,
    slack: work.slack
  });
}

/** Handle Slack block actions without free-form classification. */
export async function handleSlackAction(input: {
  work: InboundWork;
  store: ControlStore;
  github: GitHubPort;
  slack: SlackPort;
}): Promise<void> {
  const { work, store, github, slack } = input;
  const actionId = work.actionId ?? '';
  const value = parseActionValue(work.actionValue ?? work.text);

  if (LINK_ONLY_ACTIONS.has(actionId)) {
    const correlation = await resolveCorrelation(store, value);
    const details = renderSlackRunDetails({
      runId: value.runId ?? correlation?.runId ?? 'unknown',
      status: correlation?.status ?? 'unknown'
    });
    await slack.postThreadNotice({
      channelId: work.slack.channelId,
      threadTs: work.slack.threadTs,
      text: details.text
    });
    await store.markCompleted(work.requestId, 'action-handled');
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
    const command = rebuildCommand(correlation, work, intent);
    await slack.postThreadNotice({
      channelId: work.slack.channelId,
      threadTs: work.slack.threadTs,
      text: `Working on it (\`${work.requestId}\`)…`
    });
    const dispatched = await github.dispatch(command, work.requestId);
    await store.markDispatched(work.requestId, command, dispatched.runId);
    await slack.postThreadNotice({
      channelId: work.slack.channelId,
      threadTs: work.slack.threadTs,
      text: dispatched.htmlUrl
        ? `Dispatched GitHub Actions: ${dispatched.htmlUrl}`
        : `Dispatched GitHub Actions for \`${command.intent}\`.`
    });
    return;
  }

  throw new Error(`Unsupported Slack action: ${actionId || 'unknown'}`);
}
