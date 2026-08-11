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
  reportUrl?: string;
  rerunValue?: string;
  triageValue?: string;
}

export interface SlackBlockPayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

const hasCounts = (summary: RunSummary): summary is RunSummary & RunCounts =>
  [summary.total, summary.passed, summary.failed, summary.skipped].every(Number.isInteger);

export function renderSlackRunSummary(
  summary: RunSummary,
  actions: RunSummaryActions = {}
): SlackBlockPayload {
  const outcome = hasCounts(summary)
    ? `${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped`
    : summary.status;
  const text = `Qali run ${summary.runId}: ${outcome}`;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Qali run ${summary.runId}* · ${summary.status}\n${outcome}` }
    }
  ];

  const terminal = isTerminalRunStatus(summary);
  const failed =
    summary.conclusion === 'failure' ||
    summary.status === 'failure' ||
    (hasCounts(summary) && summary.failed > 0);
  const elements: Array<Record<string, unknown>> = [];

  // Link-only Details (opens GitHub). While in progress, this is the only control shown.
  if (actions.detailsUrl) {
    elements.push({
      type: 'button',
      action_id: 'open_run_url',
      text: { type: 'plain_text', text: 'Details' },
      url: actions.detailsUrl
    });
  }

  if (terminal) {
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
    if (actions.reportUrl) {
      elements.push({
        type: 'button',
        action_id: 'open_report',
        text: { type: 'plain_text', text: 'Report' },
        url: actions.reportUrl
      });
    }
  }

  if (elements.length > 0) {
    blocks.push({ type: 'actions', elements });
  }
  return { text, blocks };
}

/** True when the run has finished (success, failure, cancelled, etc.). */
export function isTerminalRunStatus(summary: Pick<RunSummary, 'status' | 'conclusion'>): boolean {
  if (summary.conclusion) return true;
  const status = summary.status.toLowerCase();
  return !['queued', 'waiting', 'requested', 'pending', 'in_progress', 'running'].includes(status);
}

export function renderSlackRunDetails(summary: RunSummary): SlackBlockPayload {
  const detailLines = [
    `Status: ${summary.status}`,
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
    text: `Qali run ${summary.runId} details`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Qali run ${summary.runId} details*\n${detailLines.join('\n')}`
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
    `Status: **${summary.status}**`,
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
