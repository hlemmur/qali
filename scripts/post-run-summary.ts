#!/usr/bin/env node
/**
 * Posts a compact run summary to the Qali control-plane Worker after Actions finishes.
 * Uses a dedicated Actions callback secret that is separate from GitHub webhooks.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ARTIFACT_REPORT_README,
  REPORT_ACCESS_TTL_SECONDS,
  REPORT_ATTACHMENT_MAX_BYTES,
  REPORT_ATTACHMENT_MAX_COUNT,
  describeExecutionCase,
  renderHtmlReport,
  reportAssetObjectKey,
  signReportAccess,
  type RunSummary,
  type RunTestCase
} from '@qali/reporting';

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

export function findRunReport(
  projectRoot: string,
  intent?: string
): Record<string, unknown> | undefined {
  const candidates = [
    join(projectRoot, 'derived/reports/test-run.json'),
    join(projectRoot, 'derived/reports/slack-summary.json'),
    '.qali/slack-summary.json'
  ];
  for (const candidate of candidates) {
    const json = readJson(candidate);
    if (!json) continue;
    if (candidate.endsWith('test-run.json') && intent && intent !== 'run-test-suite') continue;
    if (intent && typeof json.intent === 'string' && json.intent !== intent) continue;
    return json;
  }
  return undefined;
}

export function generatedTestsPayload(
  projectRoot: string,
  projectId: string,
  intent?: string
): { count: number; area: string; titles?: string[] } | undefined {
  if (intent !== 'generate-test-suite') return undefined;
  const generatedDirectory = join(projectRoot, 'tests/generated');
  const files = listGeneratedSpecFiles(generatedDirectory);
  if (files.length === 0) return undefined;
  const titles = files
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\btest(?:\.(?:only))?\(\s*(['"`])([^'"`]+)\1/g)].map(
        (match) => match[2]!
      )
    )
    .sort((left, right) => left.localeCompare(right));
  return {
    count: files.length,
    area: projectId,
    ...(titles.length ? { titles } : {})
  };
}

function listGeneratedSpecFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return listGeneratedSpecFiles(absolute);
    return entry.name.endsWith('.spec.ts') ? [absolute] : [];
  });
}

export function materializeGenerationSidecar(
  projectRoot: string,
  projectId: string,
  focus?: string
): void {
  const payload = generatedTestsPayload(projectRoot, projectId, 'generate-test-suite');
  if (!payload) return;
  const coveragePath = join(projectRoot, 'derived/scenarios/coverage-map.md');
  const coverageExcerpt = existsSync(coveragePath)
    ? readFileSync(coveragePath, 'utf8').split('\n').slice(0, 16).join('\n')
    : undefined;
  const files = listGeneratedSpecFiles(join(projectRoot, 'tests/generated')).map((file) => {
    const title =
      [
        ...readFileSync(file, 'utf8').matchAll(/\btest(?:\.(?:only))?\(\s*(['"`])([^'"`]+)\1/g)
      ][0]?.[2] ?? basename(file);
    return { path: file.slice(projectRoot.length + 1).replaceAll('\\', '/'), title };
  });
  const sidecar = {
    version: 1,
    focus,
    coverageExcerpt,
    files,
    tags: ['@smoke', '@regression'],
    count: payload.count
  };
  mkdirSync(join(projectRoot, 'derived/reports'), { recursive: true });
  writeFileSync(
    join(projectRoot, 'derived/reports/generation.json'),
    `${JSON.stringify(sidecar, null, 2)}\n`
  );
}

export function hostedSessionFields(
  report: Record<string, unknown>
): Partial<Pick<RunSummary, 'generation' | 'generatedTests' | 'qualitySnapshot' | 'triage'>> {
  const objectValue = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const generation = objectValue(report.generation) as RunSummary['generation'] | undefined;
  const generatedTests = objectValue(report.generatedTests) as
    RunSummary['generatedTests'] | undefined;
  const qualitySnapshot = objectValue(report.qualitySnapshot) as
    RunSummary['qualitySnapshot'] | undefined;
  const triage = objectValue(report.triage) as RunSummary['triage'] | undefined;
  return {
    ...(generation ? { generation } : {}),
    ...(generatedTests ? { generatedTests } : {}),
    ...(qualitySnapshot ? { qualitySnapshot } : {}),
    ...(triage ? { triage } : {})
  };
}

export function reportTests(
  report: Record<string, unknown>
): NonNullable<RunSummary['tests']> | undefined {
  if (!Array.isArray(report.tests)) return undefined;
  const tests = report.tests.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as {
      title?: unknown;
      status?: unknown;
      error?: unknown;
      durationMs?: unknown;
      retries?: unknown;
      file?: unknown;
      suite?: unknown;
      description?: unknown;
      screenshotPath?: unknown;
    };
    if (typeof value.title !== 'string' || typeof value.status !== 'string') return [];
    const test: RunTestCase = {
      title: value.title,
      status: value.status,
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
      ...(typeof value.retries === 'number' ? { retries: value.retries } : {}),
      ...(typeof value.file === 'string' ? { file: value.file } : {}),
      ...(typeof value.suite === 'string' ? { suite: value.suite } : {}),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(typeof value.screenshotPath === 'string' ? { screenshotPath: value.screenshotPath } : {})
    };
    return [test];
  });
  return tests.length ? tests : undefined;
}

export function loadJourneyMarkdown(
  projectRoot: string,
  workspace = process.cwd()
): string | undefined {
  const path = join(workspace, projectRoot, 'sources/reference/journeys.md');
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf8');
}

export function applyJourneyDescriptions(
  tests: RunTestCase[],
  journeysMarkdown?: string
): RunTestCase[] {
  if (!journeysMarkdown) return tests;
  return tests.map((test) => {
    const described = describeExecutionCase(test.title, journeysMarkdown);
    return {
      ...test,
      description: test.description ?? described.description
    };
  });
}

export function shouldSkipScreenshot(path: string): boolean {
  return /password/i.test(path);
}

export async function prepareFailureScreenshots(input: {
  tests: RunTestCase[];
  workspace: string;
  projectId: string;
  runId: string;
  workerBase: string;
  secret: string;
  expiresAtSeconds: number;
}): Promise<{ tests: RunTestCase[]; attachments: Array<{ filename: string; data: string }> }> {
  const attachments: Array<{ filename: string; data: string }> = [];
  const tests = [...input.tests];
  for (const [index, test] of tests.entries()) {
    if (test.status === 'passed' || test.status === 'skipped') continue;
    const source = test.screenshotPath;
    if (!source || shouldSkipScreenshot(source)) continue;
    if (attachments.length >= REPORT_ATTACHMENT_MAX_COUNT) break;
    const absPath = resolve(input.workspace, source);
    if (!existsSync(absPath)) continue;
    const bytes = readFileSync(absPath);
    if (bytes.byteLength === 0 || bytes.byteLength > REPORT_ATTACHMENT_MAX_BYTES) continue;
    const extension =
      basename(absPath)
        .match(/\.(png|jpe?g|webp)$/i)?.[1]
        ?.toLowerCase() ?? 'png';
    const filename = `shot-${attachments.length}.${extension === 'jpeg' ? 'jpg' : extension}`;
    try {
      reportAssetObjectKey(input.projectId, input.runId, filename);
    } catch {
      continue;
    }
    const signed = await signReportAccess({
      baseUrl: input.workerBase,
      key: `${input.projectId}/${input.runId}/${filename}`,
      secret: input.secret,
      expiresAtSeconds: input.expiresAtSeconds
    });
    attachments.push({ filename, data: bytes.toString('base64') });
    tests[index] = { ...test, screenshotUrl: signed.url };
  }
  return { tests, attachments };
}

export async function prepareExplorationScreenshots(input: {
  exploration: NonNullable<RunSummary['exploration']>;
  workspace: string;
  projectRoot: string;
  projectId: string;
  runId: string;
  workerBase: string;
  secret: string;
  expiresAtSeconds: number;
}): Promise<{
  exploration: NonNullable<RunSummary['exploration']>;
  attachments: Array<{ filename: string; data: string }>;
}> {
  const attachments: Array<{ filename: string; data: string }> = [];
  const evidenceDirectory = join(
    input.workspace,
    input.projectRoot,
    'observations/evidence/exploration'
  );
  if (!existsSync(evidenceDirectory)) {
    return { exploration: input.exploration, attachments };
  }
  const files = readdirSync(evidenceDirectory, { recursive: true, encoding: 'utf8' })
    .map((name) => String(name))
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name) && !shouldSkipScreenshot(name));
  const screenshotUrls: string[] = [...(input.exploration.screenshotUrls ?? [])];
  for (const relative of files) {
    if (attachments.length >= REPORT_ATTACHMENT_MAX_COUNT) break;
    const absPath = join(evidenceDirectory, relative);
    if (!existsSync(absPath)) continue;
    const bytes = readFileSync(absPath);
    if (bytes.byteLength === 0 || bytes.byteLength > REPORT_ATTACHMENT_MAX_BYTES) continue;
    const extension =
      basename(absPath)
        .match(/\.(png|jpe?g|webp)$/i)?.[1]
        ?.toLowerCase() ?? 'png';
    const filename = `explore-${attachments.length}.${extension === 'jpeg' ? 'jpg' : extension}`;
    try {
      reportAssetObjectKey(input.projectId, input.runId, filename);
    } catch {
      continue;
    }
    const signed = await signReportAccess({
      baseUrl: input.workerBase,
      key: `${input.projectId}/${input.runId}/${filename}`,
      secret: input.secret,
      expiresAtSeconds: input.expiresAtSeconds
    });
    attachments.push({ filename, data: bytes.toString('base64') });
    screenshotUrls.push(signed.url);
  }
  return {
    exploration: {
      ...input.exploration,
      ...(screenshotUrls.length ? { screenshotUrls } : {})
    },
    attachments
  };
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
  attachments?: Array<{ filename: string; data: string }>;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> {
  const body = JSON.stringify({
    ...(input.requestId ? { requestId: input.requestId } : {}),
    runId: input.runId,
    projectId: input.projectId,
    html: input.html,
    ...(input.attachments?.length ? { attachments: input.attachments } : {})
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

function githubRunUrlFromEnv(env = process.env): string | undefined {
  if (env.GITHUB_RUN_URL) return env.GITHUB_RUN_URL;
  if (!env.GITHUB_RUN_ID || !env.GITHUB_REPOSITORY) return undefined;
  return `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function loadGenerationSummary(projectRoot: string): RunSummary['generation'] | undefined {
  const sidecar = readJson(join(projectRoot, 'derived/reports/generation.json'));
  if (!sidecar) return undefined;
  const files = Array.isArray(sidecar.files)
    ? sidecar.files.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const value = entry as { path?: unknown; title?: unknown };
        if (typeof value.path !== 'string') return [];
        return [
          {
            path: value.path,
            title: typeof value.title === 'string' ? value.title : ''
          }
        ];
      })
    : [];
  return {
    ...(typeof sidecar.focus === 'string' ? { focus: sidecar.focus } : {}),
    ...(typeof sidecar.coverageExcerpt === 'string'
      ? { coverageExcerpt: sidecar.coverageExcerpt }
      : {}),
    ...(files.length ? { files } : {}),
    ...(Array.isArray(sidecar.traceability)
      ? {
          traceability: sidecar.traceability.filter(
            (entry): entry is string => typeof entry === 'string'
          )
        }
      : {}),
    ...(Array.isArray(sidecar.tags)
      ? { tags: sidecar.tags.filter((entry): entry is string => typeof entry === 'string') }
      : {})
  };
}

function loadExplorationSummary(projectRoot: string): RunSummary['exploration'] | undefined {
  const sidecar = readJson(join(projectRoot, 'derived/reports/exploration.json'));
  if (!sidecar || sidecar.intent !== 'explore-project') return undefined;
  const budget =
    sidecar.budget && typeof sidecar.budget === 'object'
      ? (sidecar.budget as Record<string, unknown>)
      : undefined;
  return {
    ...(typeof sidecar.focus === 'string' ? { focus: sidecar.focus } : {}),
    ...(typeof sidecar.charter === 'string' ? { charter: sidecar.charter } : {}),
    ...(budget && typeof budget.maxSteps === 'number' && typeof budget.timeBudgetMs === 'number'
      ? {
          budget: {
            maxSteps: budget.maxSteps,
            timeBudgetMs: budget.timeBudgetMs,
            ...(typeof budget.completedSteps === 'number'
              ? { completedSteps: budget.completedSteps }
              : {})
          }
        }
      : {}),
    ...(typeof sidecar.truncated === 'boolean' ? { truncated: sidecar.truncated } : {}),
    ...(typeof sidecar.profile === 'string' ? { profile: sidecar.profile } : {}),
    ...(Array.isArray(sidecar.skills)
      ? { skills: sidecar.skills.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(Array.isArray(sidecar.timeline)
      ? {
          timeline: sidecar.timeline.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const value = entry as { action?: unknown; observation?: unknown; evidence?: unknown };
            if (typeof value.action !== 'string') return [];
            return [
              {
                action: value.action,
                ...(typeof value.observation === 'string'
                  ? { observation: value.observation }
                  : {}),
                ...(typeof value.evidence === 'string' ? { evidence: value.evidence } : {})
              }
            ];
          })
        }
      : {}),
    ...(Array.isArray(sidecar.areas)
      ? { areas: sidecar.areas.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(Array.isArray(sidecar.ideas)
      ? { ideas: sidecar.ideas.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(Array.isArray(sidecar.findings)
      ? { findings: sidecar.findings.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(Array.isArray(sidecar.questions)
      ? {
          questions: sidecar.questions.filter((entry): entry is string => typeof entry === 'string')
        }
      : {}),
    ...(Array.isArray(sidecar.assumptions)
      ? {
          assumptions: sidecar.assumptions.filter(
            (entry): entry is string => typeof entry === 'string'
          )
        }
      : {})
  };
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
  const report = findRunReport(project.root, process.env.SUMMARY_INTENT) ?? {};
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
  const nowSeconds = Math.floor(Date.now() / 1000);
  let tests = reportTests(report);
  let attachments: Array<{ filename: string; data: string }> = [];
  if (tests) {
    tests = applyJourneyDescriptions(tests, loadJourneyMarkdown(project.root));
    if (runId) {
      const prepared = await prepareFailureScreenshots({
        tests,
        workspace: process.cwd(),
        projectId: project.id,
        runId,
        workerBase,
        secret,
        expiresAtSeconds: nowSeconds + REPORT_ACCESS_TTL_SECONDS
      });
      tests = prepared.tests;
      attachments = prepared.attachments;
    }
  }
  let exploration =
    process.env.SUMMARY_INTENT === 'explore-project'
      ? loadExplorationSummary(project.root)
      : undefined;
  if (exploration && runId) {
    const prepared = await prepareExplorationScreenshots({
      exploration,
      workspace: process.cwd(),
      projectRoot: project.root,
      projectId: project.id,
      runId,
      workerBase,
      secret,
      expiresAtSeconds: nowSeconds + REPORT_ACCESS_TTL_SECONDS
    });
    exploration = prepared.exploration;
    attachments = [...attachments, ...prepared.attachments];
  }
  const session = hostedSessionFields(report);
  const qualitySnapshot =
    session.qualitySnapshot ??
    (snapshot ? (snapshot as NonNullable<RunSummary['qualitySnapshot']>) : undefined);
  const generation = session.generation ?? loadGenerationSummary(project.root);
  const generatedTests =
    session.generatedTests ??
    generatedTestsPayload(project.root, project.id, process.env.SUMMARY_INTENT);
  const githubRunUrl = githubRunUrlFromEnv();
  const specUrl =
    generatedTests && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/tree/${process.env.GITHUB_SHA ?? 'main'}/${project.root}/tests/generated`
      : undefined;
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
    ...(counts ?? {}),
    ...(exploration ? { exploration } : {}),
    ...(generation ? { generation } : {}),
    ...(generatedTests ? { generatedTests } : {}),
    ...(session.triage ? { triage: session.triage } : {}),
    ...(qualitySnapshot ? { qualitySnapshot } : {}),
    ...(githubRunUrl ? { githubRunUrl } : {}),
    ...(specUrl ? { specUrl } : {})
  };
  const html = renderHtmlReport(htmlSummary);
  mkdirSync('.qali', { recursive: true });
  writeFileSync('.qali/report.html', html);
  writeFileSync('report.html', html);
  writeFileSync('README.txt', ARTIFACT_REPORT_README);

  let reportUrl: string | undefined;
  if (runId) {
    try {
      reportUrl = await publishHostedReport({
        workerBase,
        secret,
        runId,
        projectId: project.id,
        html,
        nowSeconds,
        nonce:
          process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
            ? `${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}:report`
            : `${randomUUID()}:report`,
        ...(requestId ? { requestId } : {}),
        ...(attachments.length ? { attachments } : {})
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`hosted report upload failed: ${detail.slice(0, 400)}`);
    }
  }

  const body = JSON.stringify({
    requestId,
    runId,
    htmlUrl: githubRunUrl ?? process.env.GITHUB_RUN_URL,
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
    ...(snapshot ? { qualitySnapshot: snapshot } : {}),
    ...(htmlSummary.exploration ? { exploration: htmlSummary.exploration } : {}),
    ...(htmlSummary.generation ? { generation: htmlSummary.generation } : {})
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
