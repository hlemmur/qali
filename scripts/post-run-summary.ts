#!/usr/bin/env node
/**
 * Posts a compact run summary to the Qali control-plane Worker after Actions finishes.
 * Uses a dedicated Actions callback secret that is separate from GitHub webhooks.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderHtmlReport, type RunSummary } from '@qali/reporting';

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function projectRootFromEnv(): { id: string; root: string } {
  const raw = process.env.PROJECT_JSON ?? process.env.SUMMARY_PROJECT;
  if (!raw) return { id: 'sauce-demo', root: 'projects/sauce-demo' };
  try {
    const parsed = JSON.parse(raw) as { id?: string; root?: string };
    return {
      id: parsed.id ?? 'sauce-demo',
      root: parsed.root ?? `projects/${parsed.id ?? 'sauce-demo'}`
    };
  } catch {
    return { id: 'sauce-demo', root: 'projects/sauce-demo' };
  }
}

function findTestRunJson(projectRoot: string): Record<string, unknown> | undefined {
  const candidates = [
    join(projectRoot, 'derived/reports/test-run.json'),
    join(projectRoot, 'derived/reports/slack-summary.json'),
    '.qali/slack-summary.json'
  ];
  for (const candidate of candidates) {
    const json = readJson(candidate);
    if (json) return json;
  }
  return undefined;
}

export function reportTests(
  report: Record<string, unknown>
): NonNullable<RunSummary['tests']> | undefined {
  if (!Array.isArray(report.tests)) return undefined;
  const tests = report.tests.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as { title?: unknown; status?: unknown; error?: unknown };
    if (typeof value.title !== 'string' || typeof value.status !== 'string') return [];
    return [
      {
        title: value.title,
        status: value.status,
        ...(typeof value.error === 'string' ? { error: value.error } : {})
      }
    ];
  });
  return tests.length ? tests : undefined;
}

function sign(secret: string, body: string): string {
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${digest}`;
}

export function callbackAuthenticationHeaders(
  secret: string,
  body: string,
  nowSeconds: number,
  nonce: string
): Record<string, string> {
  const timestamp = String(nowSeconds);
  return {
    'x-qali-timestamp': timestamp,
    'x-qali-nonce': nonce,
    'x-qali-signature': sign(secret, `${timestamp}.${nonce}.${body}`)
  };
}

/** Prefer Actions job outcome over an earlier in-workflow Slack summary. */
export function resolveSlackRunStatus(jobStatus: string, reportStatus: unknown): string {
  if (jobStatus === 'failure' || jobStatus === 'cancelled') return 'failed';
  if (typeof reportStatus === 'string') return reportStatus;
  if (jobStatus === 'success') return 'passed';
  return jobStatus;
}

const KITCHEN_LANGUAGE = /GitHub Actions|test report was produced/i;

const INTENT_INCOMPLETE: Record<string, string> = {
  'explore-project': 'Exploration did not finish with a complete report.',
  'onboard-project': 'Onboarding did not finish with a complete report.',
  'generate-test-suite': 'Test generation did not finish.',
  'run-test-suite': 'The test run did not finish with a complete report.',
  'triage-failure': 'Triage did not finish with a complete report.',
  'maintain-knowledge': 'Knowledge maintenance did not finish.',
  'maintain-suite': 'Suite maintenance did not finish.',
  'maintain-schedule': 'The schedule change did not finish.',
  'quality-pulse': 'Quality pulse did not finish.',
  'query-project': 'I could not finish reading the project pack.'
};

export function userFacingFailureDetails(input: {
  jobStatus: string;
  intent?: string;
  hasCounts: boolean;
  existingErrors: string[];
  executeResult?: string;
  publishResult?: string;
}): string[] {
  const cleaned = input.existingErrors.filter((error) => !KITCHEN_LANGUAGE.test(error));
  const publicationFailed =
    input.publishResult === 'failure' ||
    input.publishResult === 'cancelled' ||
    (input.executeResult === 'success' &&
      Boolean(input.publishResult) &&
      input.publishResult !== 'success');
  if (input.jobStatus !== 'failure' && input.jobStatus !== 'cancelled') {
    return cleaned;
  }
  if (publicationFailed) {
    const published = 'Work finished, but the review change could not be published.';
    return cleaned.includes(published) ? cleaned : [...cleaned, published];
  }
  if (cleaned.length > 0) return cleaned;
  if (input.hasCounts) return cleaned;
  return [
    INTENT_INCOMPLETE[input.intent ?? ''] ?? 'The run did not finish with a complete report.'
  ];
}

export function describeRunStages(
  executeResult?: string,
  publishResult?: string
): { execution?: string; publication?: string } {
  const normalize = (result?: string): string | undefined => {
    if (!result || result === 'skipped') return undefined;
    if (result === 'success') return 'passed';
    if (result === 'failure' || result === 'cancelled') return 'failed';
    return result;
  };
  const execution = normalize(executeResult);
  const publication = normalize(publishResult);
  const stages: { execution?: string; publication?: string } = {};
  if (execution) stages.execution = execution;
  if (publication) stages.publication = publication;
  return stages;
}

export async function publishHostedReport(input: {
  workerBase: string;
  secret: string;
  runId: string;
  projectId: string;
  html: string;
  nowSeconds: number;
  nonce: string;
  requestId?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> {
  const body = JSON.stringify({
    ...(input.requestId ? { requestId: input.requestId } : {}),
    runId: input.runId,
    projectId: input.projectId,
    html: input.html
  });
  const response = await (input.fetchImpl ?? fetch)(`${input.workerBase}/github/report`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...callbackAuthenticationHeaders(input.secret, body, input.nowSeconds, input.nonce)
    },
    body
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`hosted report upload failed: ${response.status} ${text.slice(0, 400)}`);
    return undefined;
  }
  try {
    const payload = (await response.json()) as { reportUrl?: unknown };
    return typeof payload.reportUrl === 'string' ? payload.reportUrl : undefined;
  } catch {
    return undefined;
  }
}

export async function postRunSummary(): Promise<void> {
  const workerBase = (
    process.env.QALI_WORKER_BASE_URL ??
    process.env.WORKER_BASE_URL ??
    ''
  ).replace(/\/$/, '');
  const secret = process.env.QALI_CALLBACK_SECRET;
  if (!workerBase || !secret) {
    console.log('Skipping Slack run-summary callback (QALI_WORKER_BASE_URL / secret not set).');
    return;
  }

  const project = projectRootFromEnv();
  const report = findTestRunJson(project.root) ?? {};
  const snapshot =
    readJson('.qali/quality-snapshot.json') ??
    readJson(join(project.root, 'derived/reports/quality-snapshot.json'));
  const counts =
    typeof report.total === 'number' &&
    typeof report.passed === 'number' &&
    typeof report.failed === 'number' &&
    typeof report.skipped === 'number'
      ? {
          total: report.total,
          passed: report.passed,
          failed: report.failed,
          skipped: report.skipped
        }
      : undefined;

  const jobStatus = process.env.JOB_STATUS ?? 'unknown';
  const status = resolveSlackRunStatus(jobStatus, report.status);
  const stages = describeRunStages(process.env.EXECUTE_RESULT, process.env.PUBLISH_RESULT);

  const errors = userFacingFailureDetails({
    jobStatus,
    hasCounts: Boolean(counts),
    existingErrors: Array.isArray(report.errors)
      ? report.errors.filter((entry): entry is string => typeof entry === 'string')
      : [],
    ...(process.env.SUMMARY_INTENT ? { intent: process.env.SUMMARY_INTENT } : {}),
    ...(process.env.EXECUTE_RESULT ? { executeResult: process.env.EXECUTE_RESULT } : {}),
    ...(process.env.PUBLISH_RESULT ? { publishResult: process.env.PUBLISH_RESULT } : {})
  });

  const runId = process.env.GITHUB_RUN_ID;
  const requestId = process.env.SUMMARY_REQUEST_ID ?? process.env.QALI_REQUEST_ID;
  const tests = reportTests(report);
  const htmlSummary: RunSummary = {
    runId: runId ?? 'unknown',
    status,
    ...(process.env.SUMMARY_INTENT ? { intent: process.env.SUMMARY_INTENT } : {}),
    projectId: project.id,
    ...(typeof report.suiteLabel === 'string'
      ? { suiteLabel: report.suiteLabel }
      : process.env.SUMMARY_INTENT === 'run-test-suite'
        ? { suiteLabel: 'smoke' }
        : {}),
    ...(Object.keys(stages).length ? { stages } : {}),
    ...(typeof report.durationMs === 'number' ? { durationMs: report.durationMs } : {}),
    ...(errors.length ? { errors } : {}),
    ...(Array.isArray(report.evidence)
      ? { evidence: report.evidence.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(tests ? { tests } : {}),
    ...(counts ?? {})
  };
  const html = renderHtmlReport(htmlSummary);
  mkdirSync('.qali', { recursive: true });
  writeFileSync('.qali/report.html', html);

  let reportUrl: string | undefined;
  if (runId) {
    try {
      reportUrl = await publishHostedReport({
        workerBase,
        secret,
        runId,
        projectId: project.id,
        html,
        nowSeconds: Math.floor(Date.now() / 1000),
        nonce:
          process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
            ? `${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}:report`
            : `${randomUUID()}:report`,
        ...(requestId ? { requestId } : {})
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`hosted report upload failed: ${detail.slice(0, 400)}`);
    }
  }

  const generatedDirectory = join(project.root, 'tests/generated');
  const generatedCount = existsSync(generatedDirectory)
    ? readdirSync(generatedDirectory).filter((name) => name.endsWith('.generated.spec.ts')).length
    : 0;
  const specUrl =
    generatedCount > 0 && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/tree/${process.env.GITHUB_SHA ?? 'main'}/${project.root}/tests/generated`
      : undefined;
  const generatedTests =
    generatedCount > 0 ? { count: generatedCount, area: project.id } : undefined;

  const body = JSON.stringify({
    requestId,
    runId,
    htmlUrl: process.env.GITHUB_RUN_URL,
    ...(reportUrl ? { reportUrl } : {}),
    ...(specUrl ? { specUrl } : {}),
    ...(generatedTests ? { generatedTests } : {}),
    intent: process.env.SUMMARY_INTENT,
    projectId: project.id,
    ...(typeof report.suiteLabel === 'string'
      ? { suiteLabel: report.suiteLabel }
      : process.env.SUMMARY_INTENT === 'run-test-suite'
        ? { suiteLabel: 'smoke' }
        : {}),
    status,
    ...(Object.keys(stages).length ? { stages } : {}),
    ...(typeof report.durationMs === 'number' ? { durationMs: report.durationMs } : {}),
    ...(errors.length ? { errors } : {}),
    ...(Array.isArray(report.evidence) ? { evidence: report.evidence } : {}),
    ...(counts ? { counts } : {}),
    ...(snapshot ? { qualitySnapshot: snapshot } : {})
  });

  const url = `${workerBase}/github/run-summary`;
  const nonce =
    process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
      ? `${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`
      : randomUUID();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...callbackAuthenticationHeaders(secret, body, Math.floor(Date.now() / 1000), nonce)
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`run-summary callback failed: ${response.status} ${text.slice(0, 400)}`);
    process.exitCode = 1;
  } else {
    const text = await response.text();
    console.log(`Posted run summary to ${url} (${response.status}) ${text.slice(0, 200)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await postRunSummary();
}
