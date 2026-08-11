export interface RunCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface RunSummary {
  runId: string;
  status: string;
  conclusion?: string;
  intent?: string;
  projectId?: string;
  suiteLabel?: string;
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  durationMs?: number;
  evidence?: string[];
  errors?: string[];
}

export interface RunSummaryActions {
  detailsUrl?: string;
  rerunValue?: string;
  triageValue?: string;
  expandValue?: string;
  expanded?: boolean;
}

export interface SlackBlockPayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

const hasCounts = (summary: RunSummary): summary is RunSummary & RunCounts =>
  [summary.total, summary.passed, summary.failed, summary.skipped].every(Number.isInteger);

export function displayRunStatus(summary: Pick<RunSummary, 'status' | 'conclusion'>): string {
  const raw = (summary.conclusion ?? summary.status).toLowerCase();
  if (raw === 'success' || raw === 'passed') return 'passed';
  if (raw === 'failure' || raw === 'failed') return 'failed';
  if (raw === 'blocked') return 'blocked';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  if (raw === 'timed_out') return 'timed out';
  return summary.conclusion ?? summary.status;
}

/** True when the run has finished (success, failure, cancelled, etc.). */
export function isTerminalRunStatus(summary: Pick<RunSummary, 'status' | 'conclusion'>): boolean {
  if (summary.conclusion) return true;
  const status = summary.status.toLowerCase();
  return !['queued', 'waiting', 'requested', 'pending', 'in_progress', 'running'].includes(status);
}

function headline(summary: RunSummary): string {
  const status = displayRunStatus(summary);
  const bits = [
    summary.intent ? `*${summary.intent}*` : '*Qali*',
    summary.projectId ? `\`${summary.projectId}\`` : undefined,
    summary.suiteLabel ? summary.suiteLabel : undefined,
    status
  ].filter(Boolean);
  return bits.join(' · ');
}

export function renderSlackRunSummary(
  summary: RunSummary,
  actions: RunSummaryActions = {}
): SlackBlockPayload {
  const status = displayRunStatus(summary);
  const title = headline(summary);
  const countLine = hasCounts(summary)
    ? `${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped` +
      (summary.total !== undefined ? ` (${summary.total} total)` : '')
    : undefined;
  const failureLine =
    summary.errors && summary.errors.length > 0
      ? summary.errors
          .slice(0, 3)
          .map((error) => `• ${error}`)
          .join('\n')
      : hasCounts(summary) && summary.failed > 0
        ? '• Failures recorded — expand for details'
        : undefined;

  const body = [title, countLine, failureLine].filter(Boolean).join('\n');
  const text = countLine ? `Qali ${status}: ${countLine}` : `Qali ${status}`;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: body }
    }
  ];

  if (actions.expanded) {
    const details = renderSlackRunDetails(summary);
    blocks.push(...details.blocks);
  }

  const terminal = isTerminalRunStatus(summary);
  const failed = hasCounts(summary) && summary.failed > 0;
  const elements: Array<Record<string, unknown>> = [];

  if (actions.detailsUrl) {
    elements.push({
      type: 'button',
      action_id: 'open_run_url',
      text: { type: 'plain_text', text: 'GitHub' },
      url: actions.detailsUrl
    });
  }

  if (terminal) {
    elements.push({
      type: 'button',
      action_id: actions.expanded ? 'collapse_run_details' : 'expand_run_details',
      text: { type: 'plain_text', text: actions.expanded ? 'Collapse' : 'Expand' },
      value: actions.expandValue ?? actions.rerunValue ?? summary.runId
    });
    elements.push({
      type: 'button',
      action_id: 'rerun_workflow',
      text: { type: 'plain_text', text: 'Rerun' },
      value: actions.rerunValue ?? summary.runId
    });
    if (failed) {
      elements.push({
        type: 'button',
        action_id: 'triage_failures',
        text: { type: 'plain_text', text: 'Triage' },
        value: actions.triageValue ?? summary.runId
      });
    }
  }

  if (elements.length > 0) {
    blocks.push({ type: 'actions', elements });
  }
  return { text, blocks };
}

export function renderSlackRunDetails(summary: RunSummary): SlackBlockPayload {
  const detailLines = [
    `Status: ${displayRunStatus(summary)}`,
    ...(summary.intent ? [`Intent: ${summary.intent}`] : []),
    ...(summary.projectId ? [`Project: ${summary.projectId}`] : []),
    ...(hasCounts(summary)
      ? [
          `Total: ${summary.total}`,
          `Passed: ${summary.passed}`,
          `Failed: ${summary.failed}`,
          `Skipped: ${summary.skipped}`
        ]
      : []),
    ...(summary.durationMs !== undefined ? [`Duration: ${summary.durationMs} ms`] : []),
    ...(summary.evidence?.length ? [`Evidence: ${summary.evidence.join(', ')}`] : []),
    ...(summary.errors?.length ? [`Errors: ${summary.errors.join('; ')}`] : [])
  ];
  return {
    text: `Qali details`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details*\n${detailLines.join('\n')}`
        }
      }
    ]
  };
}

export function renderRunReport(summary: RunSummary): {
  markdown: string;
  json: RunSummary;
} {
  const rows = hasCounts(summary)
    ? [
        `| Total | ${summary.total} |`,
        `| Passed | ${summary.passed} |`,
        `| Failed | ${summary.failed} |`,
        `| Skipped | ${summary.skipped} |`
      ]
    : [];
  const markdown = [
    `# Test run ${summary.runId}`,
    '',
    `Status: **${displayRunStatus(summary)}**`,
    ...(rows.length ? ['', '| Result | Count |', '| --- | ---: |', ...rows] : []),
    ...(summary.durationMs !== undefined ? ['', `Duration: ${summary.durationMs} ms`] : []),
    ...(summary.evidence?.length
      ? ['', '## Evidence', ...summary.evidence.map((path) => `- \`${path}\``)]
      : []),
    ...(summary.errors?.length
      ? ['', '## Errors', ...summary.errors.map((error) => `- ${error}`)]
      : []),
    ''
  ].join('\n');
  return { markdown, json: { ...summary } };
}
