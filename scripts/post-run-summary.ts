#!/usr/bin/env node
/**
 * Posts a compact run summary to the Qali control-plane Worker after Actions finishes.
 * Uses the same HMAC secret as GitHub webhooks (GITHUB_WEBHOOK_SECRET / QALI_CALLBACK_SECRET).
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  if (!raw) return { id: '_demo', root: 'projects/_demo' };
  try {
    const parsed = JSON.parse(raw) as { id?: string; root?: string };
    return {
      id: parsed.id ?? '_demo',
      root: parsed.root ?? `projects/${parsed.id ?? '_demo'}`
    };
  } catch {
    return { id: '_demo', root: 'projects/_demo' };
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

function sign(secret: string, body: string): string {
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${digest}`;
}

const workerBase = (process.env.QALI_WORKER_BASE_URL ?? process.env.WORKER_BASE_URL ?? '').replace(
  /\/$/,
  ''
);
const secret = process.env.QALI_CALLBACK_SECRET ?? process.env.GITHUB_WEBHOOK_SECRET;
if (!workerBase || !secret) {
  console.log('Skipping Slack run-summary callback (QALI_WORKER_BASE_URL / secret not set).');
  process.exit(0);
}

const project = projectRootFromEnv();
const report = findTestRunJson(project.root) ?? {};
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
const hasReport = Object.keys(report).length > 0;
const status =
  typeof report.status === 'string'
    ? report.status
    : jobStatus === 'success'
      ? 'passed'
      : jobStatus === 'failure' || jobStatus === 'cancelled'
        ? 'failed'
        : jobStatus;

const errors = Array.isArray(report.errors)
  ? report.errors.filter((entry): entry is string => typeof entry === 'string')
  : [];
if (!counts && jobStatus === 'failure') {
  errors.push('GitHub Actions failed before a test report was produced');
}

const body = JSON.stringify({
  requestId: process.env.SUMMARY_REQUEST_ID ?? process.env.QALI_REQUEST_ID,
  runId: process.env.GITHUB_RUN_ID,
  htmlUrl: process.env.GITHUB_RUN_URL,
  intent: process.env.SUMMARY_INTENT,
  projectId: project.id,
  ...(typeof report.suiteLabel === 'string'
    ? { suiteLabel: report.suiteLabel }
    : hasReport
      ? { suiteLabel: 'smoke' }
      : {}),
  status,
  ...(typeof report.durationMs === 'number' ? { durationMs: report.durationMs } : {}),
  ...(errors.length ? { errors } : {}),
  ...(Array.isArray(report.evidence) ? { evidence: report.evidence } : {}),
  ...(counts ? { counts } : {})
});

const url = `${workerBase}/github/run-summary`;
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': sign(secret, body)
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
