import { displayRunStatus } from './run-status.js';
import type { RunSummary } from './index.js';

function escapeHtml(value: string): string {
  return value
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
  const actions = ['Open the GitHub run'];
  if (status === 'failed') {
    actions.push('Ask Qali to triage the failures');
    actions.push('Rerun from the Slack card if the environment looks healthy');
  }
  return actions;
}

export function renderHtmlReport(summary: RunSummary): string {
  const status = displayRunStatus(summary);
  const titleBits = [summary.intent, summary.projectId].filter(Boolean);
  const heading = titleBits.length ? titleBits.join(' · ') : `Run ${summary.runId}`;
  const counts = [summary.total, summary.passed, summary.failed, summary.skipped].every(
    Number.isInteger
  )
    ? `${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped (${summary.total} total)`
    : undefined;
  const stages = stageLine(summary.stages ?? {});
  const findings = summary.errors?.length ? summary.errors : [];
  const evidence = summary.evidence?.length ? summary.evidence : [];
  const actions = nextActions(summary);
  const duration =
    summary.durationMs !== undefined ? `${Math.round(summary.durationMs)} ms` : undefined;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qali · ${escapeHtml(heading)} · ${escapeHtml(status)}</title>
<style>
  :root { color-scheme: light; --ink: #1b1b18; --muted: #5c5c55; --line: #e6e4dc; --bg: #f7f6f2; --card: #fff; --fail: #9b1c1c; --pass: #146c43; --warn: #8a5a00; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  header, section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; }
  .eyebrow { margin: 0 0 0.35rem; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.75rem; color: var(--muted); }
  h1, h2 { margin: 0 0 0.75rem; font-size: 1.35rem; }
  h2 { font-size: 1.05rem; }
  p, li { margin: 0.35rem 0; }
  .status { display: inline-block; font-weight: 650; text-transform: capitalize; }
  .status.failed, .status.blocked { color: var(--fail); }
  .status.passed { color: var(--pass); }
  .status.cancelled, .status.timed { color: var(--warn); }
  ul { margin: 0.25rem 0 0; padding-left: 1.2rem; }
  code { font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow">Qali report</p>
    <h1>${escapeHtml(heading)}</h1>
    <p class="status ${escapeHtml(status.split(' ')[0] ?? status)}">${escapeHtml(status)}</p>
    <p>Run <code>${escapeHtml(summary.runId)}</code>${summary.suiteLabel ? ` · ${escapeHtml(summary.suiteLabel)}` : ''}</p>
  </header>
  <section>
    <h2>Summary</h2>
    ${counts ? `<p>${escapeHtml(counts)}</p>` : '<p>No test counts were recorded for this run.</p>'}
    ${duration ? `<p>Duration: ${escapeHtml(duration)}</p>` : ''}
    ${stages ? `<p>${escapeHtml(stages)}</p>` : ''}
  </section>
  <section>
    <h2>Findings</h2>
    ${
      findings.length
        ? `<ul>${findings.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
        : '<p>No findings were recorded.</p>'
    }
  </section>
  <section>
    <h2>Evidence</h2>
    ${
      evidence.length
        ? `<ul>${evidence.map((path) => `<li><code>${escapeHtml(path)}</code></li>`).join('')}</ul>`
        : '<p>No evidence paths were recorded.</p>'
    }
  </section>
  <section>
    <h2>Next actions</h2>
    <ul>${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul>
  </section>
</main>
</body>
</html>
`;
}
