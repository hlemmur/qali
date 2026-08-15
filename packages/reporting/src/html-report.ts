import { displayRunStatus } from './run-status.js';
import type { RunSummary, RunTestCase } from './index.js';

export const ARTIFACT_REPORT_README = `Qali run artifact
=================

Open report.html for the human execution report (counts, cases, errors, failure screenshots).

playwright-report/index.html is Playwright's interactive reporter. Open it locally for traces, the step timeline, and video. It is a JavaScript app, not the Slack Open report.

test-results/ holds raw traces, videos, and screenshots.

derived/ Markdown and JSONL are machine provenance, not the user-facing report.
`;

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'title', 'name', 'message', 'finding', 'question']) {
      if (typeof record[key] === 'string') return record[key];
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function escapeHtml(value: unknown): string {
  return asText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stageLine(stages: NonNullable<RunSummary['stages']>): string | undefined {
  const bits = [
    stages.execution ? `Execution ${stages.execution}` : undefined,
    stages.validation ? `Validation ${stages.validation}` : undefined,
    stages.publication ? `Publication ${stages.publication}` : undefined
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : undefined;
}

function nextActions(summary: RunSummary): string[] {
  const status = displayRunStatus(summary);
  if (summary.intent === 'explore-project') {
    const focus = summary.exploration?.focus ?? 'this focus';
    return [
      `Generate smoke tests for ${focus}`,
      `Generate regression tests for ${focus}`,
      'Open the GitHub run'
    ];
  }
  const actions = ['Open the GitHub run'];
  if (status === 'failed') {
    actions.push('Ask Qali to triage the failures');
    actions.push('Rerun from the Slack card if the environment looks healthy');
  }
  return actions;
}

function nonTestRunNotice(intent?: string): string {
  if (intent === 'onboard-project') {
    return 'This onboard run did not execute Playwright tests. It records project context, journeys, risks, and open questions.';
  }
  if (intent === 'explore-project') {
    return 'This exploration session used the restricted browser facade. It did not execute the scripted Playwright suite.';
  }
  return 'This run did not execute Playwright tests.';
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    const rounded = seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10;
    return `${rounded}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function caseNameFromTitle(title: string): string {
  const parts = title
    .split(' › ')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? title;
}

export function journeyIdFromTitle(title: string): string | undefined {
  const match = title.match(/\bJRN-\d+\b/i);
  return match?.[0]?.toUpperCase();
}

export function journeyGoalFromMarkdown(markdown: string, journeyId: string): string | undefined {
  const heading = new RegExp(`^## ${journeyId}:\\s*(.+)$`, 'im');
  const headingMatch = markdown.match(heading);
  if (!headingMatch) return undefined;
  const start = headingMatch.index ?? 0;
  const rest = markdown.slice(start);
  const after = rest.slice(headingMatch[0].length);
  const next = after.search(/^## /m);
  const section = next >= 0 ? rest.slice(0, headingMatch[0].length + next) : rest;
  const goal = section.match(/^- Goal:\s*(.+)$/m);
  if (goal?.[1]?.trim()) return goal[1].trim();
  return headingMatch[1]?.trim();
}

export function describeExecutionCase(
  title: string,
  journeysMarkdown?: string
): { name: string; description: string } {
  const name = caseNameFromTitle(title);
  const journeyId = journeyIdFromTitle(title);
  if (journeyId && journeysMarkdown) {
    const goal = journeyGoalFromMarkdown(journeysMarkdown, journeyId);
    if (goal) return { name, description: goal };
  }
  const parts = title
    .split(' › ')
    .map((part) => part.trim())
    .filter(Boolean);
  const parent = parts.slice(0, -1).join(' › ');
  return { name, description: parent || title };
}

const STATUS_ORDER: Record<string, number> = { failed: 0, timed: 0, skipped: 1, passed: 2 };

function sortedTests(tests: RunTestCase[]): RunTestCase[] {
  return [...tests].sort(
    (left, right) => (STATUS_ORDER[left.status] ?? 9) - (STATUS_ORDER[right.status] ?? 9)
  );
}

function issueText(test: RunTestCase): string {
  if (!test.error) return '';
  return (
    test.error
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? test.error
  );
}

function passRate(summary: RunSummary): number | undefined {
  if (![summary.total, summary.passed].every(Number.isInteger) || !summary.total) {
    return undefined;
  }
  return Math.round((Number(summary.passed) / Number(summary.total)) * 100);
}

function hasCounts(summary: RunSummary): boolean {
  return [summary.total, summary.passed, summary.failed, summary.skipped].every(Number.isInteger);
}

function barSegment(count: number, total: number, klass: string): string {
  if (!total || !count) return '';
  const width = Math.max(2, Math.round((count / total) * 100));
  return `<span class="seg ${klass}" style="width:${width}%"></span>`;
}

function statusClass(status: string): string {
  if (status === 'passed') return 'ok';
  if (status === 'skipped') return 'skip';
  return 'bad';
}

export function renderHtmlReport(summary: RunSummary): string {
  const status = displayRunStatus(summary);
  const titleBits = [summary.intent, summary.projectId].filter(Boolean);
  const heading = titleBits.length ? titleBits.join(' · ') : `Run ${summary.runId}`;
  const stages = stageLine(summary.stages ?? {});
  const findings = summary.errors?.length ? summary.errors : [];
  const evidence = summary.evidence?.length ? summary.evidence : [];
  const tests = summary.tests?.length ? sortedTests(summary.tests) : [];
  const failedTests = tests.filter((test) => test.status !== 'passed' && test.status !== 'skipped');
  const actions = nextActions(summary);
  const rate = passRate(summary);
  const total = Number(summary.total ?? 0);
  const passed = Number(summary.passed ?? 0);
  const failed = Number(summary.failed ?? 0);
  const skipped = Number(summary.skipped ?? 0);
  const statusToken = status.split(' ')[0] ?? status;
  const browser =
    tests.map((test) => test.suite).find((suite) => suite && suite.length > 0) ?? undefined;

  const kpi = hasCounts(summary)
    ? `<section class="kpis" aria-label="Result counts">
    <div class="kpi"><span class="kpi-label">Total</span><span class="kpi-value">${total}</span></div>
    <div class="kpi pass"><span class="kpi-label">Passed</span><span class="kpi-value">${passed}</span></div>
    <div class="kpi fail"><span class="kpi-label">Failed</span><span class="kpi-value">${failed}</span></div>
    <div class="kpi skip"><span class="kpi-label">Skipped</span><span class="kpi-value">${skipped}</span></div>
    <div class="kpi"><span class="kpi-label">Pass rate</span><span class="kpi-value">${rate ?? 0}%</span></div>
    <div class="kpi"><span class="kpi-label">Duration</span><span class="kpi-value">${summary.durationMs !== undefined ? escapeHtml(formatDurationMs(summary.durationMs)) : '—'}</span></div>
  </section>
  <div class="bar" role="img" aria-label="Passed ${passed}, failed ${failed}, skipped ${skipped}">
    ${barSegment(passed, total, 'pass')}${barSegment(failed, total, 'fail')}${barSegment(skipped, total, 'skip')}
  </div>`
    : summary.exploration
      ? ''
      : `<section>
    <h2>Summary</h2>
    <p>No test counts were recorded for this run.</p>
    ${
      tests.length || summary.intent === 'run-test-suite'
        ? ''
        : `<p>${escapeHtml(nonTestRunNotice(summary.intent))}</p>`
    }
  </section>`;

  const failuresBlock =
    failedTests.length > 0
      ? `<section>
    <h2>Failures</h2>
    <ul class="failures">${failedTests
      .map((test) => {
        const described = describeExecutionCase(test.title);
        const duration =
          test.durationMs !== undefined ? formatDurationMs(test.durationMs) : undefined;
        const retries = test.retries
          ? ` · ${test.retries} ${test.retries === 1 ? 'retry' : 'retries'}`
          : '';
        const screenshot = test.screenshotUrl
          ? `<p><img src="${escapeHtml(test.screenshotUrl)}" alt="Failure screenshot for ${escapeHtml(described.name)}"></p>`
          : '';
        return `<li>
      <p><span class="status bad">${escapeHtml(test.status)}</span> <strong>${escapeHtml(described.name)}</strong>${duration ? ` · ${escapeHtml(duration)}` : ''}${retries}</p>
      ${test.error ? `<p class="issue">${escapeHtml(issueText(test))}</p>` : ''}
      ${screenshot}
    </li>`;
      })
      .join('')}</ul>
  </section>`
      : '';

  const tableBlock =
    tests.length > 0
      ? `<section>
    <h2>All results</h2>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Case</th>
          <th>Description</th>
          <th>Duration</th>
          <th>Issue</th>
        </tr>
      </thead>
      <tbody>
        ${tests
          .map((test) => {
            const described = describeExecutionCase(test.title);
            const description = test.description ?? described.description;
            const duration =
              test.durationMs !== undefined ? formatDurationMs(test.durationMs) : '—';
            const screenshot = test.screenshotUrl
              ? `<p><img src="${escapeHtml(test.screenshotUrl)}" alt="Failure screenshot for ${escapeHtml(described.name)}"></p>`
              : '';
            return `<tr class="${statusClass(test.status)}">
          <td><span class="status ${statusClass(test.status)}">${escapeHtml(test.status)}</span></td>
          <td>${escapeHtml(described.name)}</td>
          <td>${escapeHtml(description)}</td>
          <td>${escapeHtml(duration)}</td>
          <td class="issue">${test.error ? escapeHtml(issueText(test)) : ''}${screenshot}</td>
        </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  </section>`
      : '';

  const exploration = summary.exploration;
  const explorationBlock = exploration
    ? `<section>
    <h2>What Qali did</h2>
    <ul>
      ${exploration.charter ? `<li>Charter: ${escapeHtml(exploration.charter)}</li>` : ''}
      ${exploration.focus ? `<li>Focus: ${escapeHtml(exploration.focus)}</li>` : ''}
      ${exploration.profile ? `<li>Profile: ${escapeHtml(exploration.profile)}</li>` : ''}
      ${
        (exploration.skills ?? []).length
          ? `<li>Skills: ${escapeHtml((exploration.skills ?? []).join(', '))}</li>`
          : ''
      }
      ${
        exploration.budget
          ? `<li>Budget: ${exploration.budget.completedSteps ?? '—'} / ${exploration.budget.maxSteps} steps · cap ${escapeHtml(formatDurationMs(exploration.budget.timeBudgetMs))}${exploration.truncated ? ' · truncated' : ' · complete'}</li>`
          : ''
      }
    </ul>
  </section>
  ${
    (exploration.timeline ?? []).length
      ? `<section>
    <h2>Timeline</h2>
    <ul>${(exploration.timeline ?? [])
      .map((entry) => {
        const observation = entry.observation ? ` — ${escapeHtml(entry.observation)}` : '';
        const evidence = entry.evidence ? ` (${escapeHtml(entry.evidence)})` : '';
        return `<li>${escapeHtml(entry.action)}${observation}${evidence}</li>`;
      })
      .join('')}</ul>
  </section>`
      : ''
  }
  <section>
    <h2>Coverage</h2>
    <ul>
      ${(exploration.areas ?? []).map((area) => `<li>Area: ${escapeHtml(area)}</li>`).join('')}
      ${(exploration.ideas ?? []).map((idea) => `<li>Idea: ${escapeHtml(idea)}</li>`).join('')}
    </ul>
  </section>
  <section>
    <h2>Findings</h2>
    ${
      (exploration.findings ?? []).length ||
      (exploration.questions ?? []).length ||
      (exploration.assumptions ?? []).length
        ? `<ul>${[
            ...(exploration.findings ?? []).map((item) => `<li>${escapeHtml(item)}</li>`),
            ...(exploration.questions ?? []).map(
              (item) => `<li>Question: ${escapeHtml(item)}</li>`
            ),
            ...(exploration.assumptions ?? []).map(
              (item) => `<li>Assumption: ${escapeHtml(item)}</li>`
            )
          ].join('')}</ul>`
        : '<p>No findings were recorded.</p>'
    }
  </section>
  ${
    (exploration.screenshotUrls ?? []).length
      ? `<section>
    <h2>Evidence</h2>
    ${(exploration.screenshotUrls ?? [])
      .map(
        (url) =>
          `<p><img src="${escapeHtml(url)}" alt="Exploration evidence for ${escapeHtml(exploration.focus ?? 'session')}"></p>`
      )
      .join('')}
  </section>`
      : ''
  }`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qali · ${escapeHtml(heading)} · ${escapeHtml(status)}</title>
<style>
  :root { color-scheme: light; --ink: #1b1b18; --muted: #5c5c55; --line: #e6e4dc; --bg: #f7f6f2; --card: #fff; --fail: #9b1c1c; --pass: #146c43; --warn: #8a5a00; --fail-bg: #fdecec; --pass-bg: #e8f6ee; --warn-bg: #fff6e5; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  main { max-width: 64rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  header, section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; }
  .eyebrow { margin: 0 0 0.35rem; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.75rem; color: var(--muted); }
  h1, h2 { margin: 0 0 0.75rem; font-size: 1.35rem; }
  h2 { font-size: 1.05rem; }
  p, li { margin: 0.35rem 0; }
  .status { display: inline-block; font-weight: 650; text-transform: capitalize; }
  .status.failed, .status.blocked, .status.bad { color: var(--fail); }
  .status.passed, .status.ok { color: var(--pass); }
  .status.cancelled, .status.timed, .status.skip { color: var(--warn); }
  .meta { color: var(--muted); }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: 0.75rem; }
  .kpi { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 0.9rem 1rem; }
  .kpi-label { display: block; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .kpi-value { font-size: 1.45rem; font-weight: 700; }
  .kpi.pass .kpi-value { color: var(--pass); }
  .kpi.fail .kpi-value { color: var(--fail); }
  .kpi.skip .kpi-value { color: var(--warn); }
  .bar { display: flex; height: 0.65rem; border-radius: 999px; overflow: hidden; background: var(--line); margin: 0 0 1rem; }
  .bar .seg { display: block; height: 100%; }
  .bar .pass { background: var(--pass); }
  .bar .fail { background: var(--fail); }
  .bar .skip { background: var(--warn); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 0.65rem 0.5rem; border-bottom: 1px solid var(--line); }
  th { font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  tr.bad { background: var(--fail-bg); }
  tr.ok { background: transparent; }
  tr.skip { background: var(--warn-bg); }
  .issue { color: var(--fail); font-size: 0.92rem; }
  img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 0.5rem; }
  .failures { list-style: none; padding: 0; margin: 0; }
  .failures li { padding: 0.75rem 0; border-bottom: 1px solid var(--line); }
  .failures li:last-child { border-bottom: 0; }
  ul { margin: 0.25rem 0 0; padding-left: 1.2rem; }
  code { font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow">Qali execution report</p>
    <h1>${escapeHtml(heading)}</h1>
    <p class="status ${escapeHtml(statusToken)}">${escapeHtml(status)}</p>
    <p class="meta">Run <code>${escapeHtml(summary.runId)}</code>${summary.suiteLabel ? ` · ${escapeHtml(summary.suiteLabel)}` : ''}${browser ? ` · ${escapeHtml(browser)}` : ''}${summary.environment ? ` · ${escapeHtml(summary.environment)}` : ''}</p>
    ${stages ? `<p class="meta">${escapeHtml(stages)}</p>` : ''}
  </header>
  ${kpi}
  ${explorationBlock}
  ${failuresBlock}
  ${tableBlock}
  <section>
    <h2>Run context</h2>
    <ul>
      <li>Project: <code>${escapeHtml(summary.projectId ?? 'unknown')}</code></li>
      ${summary.intent ? `<li>Intent: ${escapeHtml(summary.intent)}</li>` : ''}
      ${summary.suiteLabel ? `<li>Suite: ${escapeHtml(summary.suiteLabel)}</li>` : ''}
      ${browser ? `<li>Browser project: ${escapeHtml(browser)}</li>` : ''}
      ${stages ? `<li>Stages: ${escapeHtml(stages)}</li>` : ''}
    </ul>
  </section>
  <section>
    <h2>Findings</h2>
    ${
      findings.length
        ? `<ul>${findings.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
        : '<p>No findings were recorded.</p>'
    }
  </section>
  ${
    evidence.length
      ? `<section>
    <h2>Evidence</h2>
    <ul>${evidence.map((path) => `<li><code>${escapeHtml(path)}</code></li>`).join('')}</ul>
  </section>`
      : ''
  }
  <section>
    <h2>Next actions</h2>
    <ul>${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul>
  </section>
</main>
</body>
</html>
`;
}
