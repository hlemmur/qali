import { displayRunStatus, isTerminalRunStatus } from './run-status.js';

export { displayRunStatus, isTerminalRunStatus };
export {
  renderHtmlReport,
  describeExecutionCase,
  formatDurationMs,
  ARTIFACT_REPORT_README
} from './html-report.js';
export {
  HTML_REPORT_MAX_CHARS,
  REPORT_ACCESS_TTL_SECONDS,
  REPORT_ATTACHMENT_MAX_BYTES,
  REPORT_ATTACHMENT_MAX_COUNT,
  contentTypeForReportAsset,
  isHostedHtmlReport,
  parseReportKey,
  reportAssetObjectKey,
  reportObjectKey,
  signReportAccess,
  verifyReportAccess
} from './report-access.js';

export interface RunCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface RunTestCase {
  title: string;
  status: string;
  error?: string;
  durationMs?: number;
  retries?: number;
  file?: string;
  suite?: string;
  description?: string;
  screenshotUrl?: string;
  screenshotPath?: string;
}

export interface RunSummary {
  runId: string;
  status: string;
  conclusion?: string;
  intent?: string;
  projectId?: string;
  suiteLabel?: string;
  environment?: string;
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  durationMs?: number;
  evidence?: string[];
  errors?: string[];
  tests?: RunTestCase[];
  stages?: {
    execution?: string;
    validation?: string;
    publication?: string;
  };
  generatedTests?: {
    count: number;
    area?: string;
    titles?: string[];
  };
  githubRunUrl?: string;
  specUrl?: string;
  generation?: {
    focus?: string;
    coverageExcerpt?: string;
    files?: Array<{ path: string; title: string }>;
    traceability?: string[];
    tags?: string[];
  };
  exploration?: {
    focus?: string;
    charter?: string;
    budget?: { maxSteps: number; timeBudgetMs: number; completedSteps?: number };
    truncated?: boolean;
    areas?: string[];
    ideas?: string[];
    findings?: string[];
    questions?: string[];
    assumptions?: string[];
    screenshotUrls?: string[];
    skills?: string[];
    profile?: string;
    timeline?: Array<{ action: string; observation?: string; evidence?: string }>;
  };
  qualitySnapshot?: {
    lastRun?: {
      intent: string;
      status: string;
      finishedAt: string;
      counts?: { passed: number; failed: number; skipped: number; total: number };
    };
    coverage?: { approvedScenarios: number; automatedTests: number; percent: number };
    knownIssues?: string[];
    openQuestions?: string[];
    schedules?: Array<{ workflowId: string; cron: string; enabled: boolean }>;
  };
  triage?: {
    fingerprint?: string;
    sourceRunId?: string;
    failureCount?: number;
    candidatePath?: string;
    observedStatus?: string;
    titles?: string[];
  };
}

export interface RunSummaryActions {
  detailsUrl?: string;
  reportUrl?: string;
  specUrl?: string;
  retractValue?: string;
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

function stageLine(stages: NonNullable<RunSummary['stages']>): string | undefined {
  const bits = [
    stages.execution ? `Execution ${stages.execution}` : undefined,
    stages.validation ? `Validation ${stages.validation}` : undefined,
    stages.publication ? `Publication ${stages.publication}` : undefined
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : undefined;
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

  const generationLine =
    summary.generatedTests && summary.generatedTests.count > 0
      ? `${summary.generatedTests.count} tests added${
          summary.generatedTests.area ? ` for ${summary.generatedTests.area}` : ''
        }${
          summary.generatedTests.titles?.length
            ? `: ${summary.generatedTests.titles.slice(0, 5).join('; ')}`
            : ''
        }`
      : undefined;
  const explorationLine = summary.exploration
    ? `${summary.exploration.findings?.length ?? 0} findings${
        summary.exploration.focus ? ` · ${summary.exploration.focus}` : ''
      }`
    : undefined;

  const citationLine = summary.exploration?.skills?.length
    ? `Used ${summary.exploration.skills.join(', ')}${
        summary.exploration.profile ? ` · ${summary.exploration.profile}` : ''
      }`
    : summary.generation?.focus
      ? `Authored from ${summary.generation.focus}`
      : actions.reportUrl
        ? 'Open report for the session record'
        : undefined;

  const body = [
    title,
    countLine,
    generationLine,
    explorationLine,
    citationLine,
    stageLine(summary.stages ?? {}),
    failureLine
  ]
    .filter(Boolean)
    .join('\n');
  const text = generationLine
    ? `Qali ${status}: ${generationLine}`
    : explorationLine
      ? `Qali ${status}: ${explorationLine}`
      : countLine
        ? `Qali ${status}: ${countLine}`
        : `Qali ${status}`;
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

  if (actions.reportUrl) {
    elements.push({
      type: 'button',
      action_id: 'open_report',
      text: { type: 'plain_text', text: 'Open report' },
      url: actions.reportUrl
    });
  }

  if (actions.specUrl) {
    elements.push({
      type: 'button',
      action_id: 'open_spec',
      text: { type: 'plain_text', text: 'View tests in GitHub' },
      url: actions.specUrl
    });
  }

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
    if (summary.generatedTests && summary.generatedTests.count > 0) {
      elements.push({
        type: 'button',
        action_id: 'retract_generated_tests',
        text: { type: 'plain_text', text: 'Retract' },
        value: actions.retractValue ?? actions.rerunValue ?? summary.runId
      });
    }
  }

  if (elements.length > 0) {
    for (let index = 0; index < elements.length; index += 5) {
      blocks.push({ type: 'actions', elements: elements.slice(index, index + 5) });
    }
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
    ...(stageLine(summary.stages ?? {}) ? [`Stages: ${stageLine(summary.stages ?? {})}`] : []),
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
    ...(summary.tests?.length
      ? [
          '',
          '## Tests',
          ...summary.tests.map((test) =>
            test.error
              ? `- **${test.status}** ${test.title} — ${test.error}`
              : `- **${test.status}** ${test.title}`
          )
        ]
      : []),
    ...(summary.errors?.length
      ? ['', '## Errors', ...summary.errors.map((error) => `- ${error}`)]
      : []),
    ''
  ].join('\n');
  return { markdown, json: { ...summary } };
}
