import { spawn as nodeSpawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';

export interface PlaywrightTestCase {
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
}

export interface PlaywrightEvidenceSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  evidence: string[];
  errors: string[];
  tests: PlaywrightTestCase[];
}

export interface PlaywrightRunEvidence extends PlaywrightEvidenceSummary {
  status: 'passed' | 'failed';
}

interface JsonResult {
  status?: string;
  duration?: number;
  error?: { message?: string };
  attachments?: Array<{ path?: string }>;
}

function collectTests(
  suite: unknown,
  parentTitle = ''
): Array<{ title: string; status?: string; results?: JsonResult[] }> {
  if (!suite || typeof suite !== 'object') return [];
  const value = suite as {
    title?: string;
    tests?: Array<{ title?: string; status?: string; results?: JsonResult[] }>;
    specs?: Array<{
      title?: string;
      tests?: Array<{ title?: string; status?: string; results?: JsonResult[] }>;
    }>;
    suites?: unknown[];
  };
  const suiteTitle = [parentTitle, value.title]
    .filter((part) => part && part.length > 0)
    .join(' › ');
  const named = (
    title: string,
    tests: Array<{ title?: string; status?: string; results?: JsonResult[] }>
  ) =>
    tests.map((test) => ({
      ...test,
      title: [title, test.title].filter((part) => part && part.length > 0).join(' › ') || 'test'
    }));
  return [
    ...named(suiteTitle, value.tests ?? []),
    ...(value.specs ?? []).flatMap((spec) =>
      named(
        [suiteTitle, spec.title].filter((part) => part && part.length > 0).join(' › '),
        spec.tests ?? []
      )
    ),
    ...(value.suites ?? []).flatMap((child) => collectTests(child, suiteTitle))
  ];
}

export function parsePlaywrightJsonReport(input: unknown): PlaywrightEvidenceSummary {
  const report = input as { suites?: unknown[] };
  const tests = (report.suites ?? []).flatMap((suite) => collectTests(suite));
  const summary: PlaywrightEvidenceSummary = {
    total: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    evidence: [],
    errors: [],
    tests: []
  };
  for (const test of tests) {
    const final = test.results?.at(-1);
    summary.durationMs +=
      test.results?.reduce((total, result) => total + (result.duration ?? 0), 0) ?? 0;
    let status: PlaywrightTestCase['status'] = 'failed';
    if (test.status === 'expected' && final?.status === 'passed') {
      summary.passed += 1;
      status = 'passed';
    } else if (test.status === 'skipped' || final?.status === 'skipped') {
      summary.skipped += 1;
      status = 'skipped';
    } else {
      summary.failed += 1;
    }
    const error = test.results?.map((result) => result.error?.message).find(Boolean);
    summary.tests.push({
      title: test.title,
      status,
      ...(error ? { error } : {})
    });
    for (const result of test.results ?? []) {
      if (result.error?.message) summary.errors.push(result.error.message);
      for (const attachment of result.attachments ?? []) {
        if (attachment.path) summary.evidence.push(attachment.path);
      }
    }
  }
  return summary;
}

export function summarizePlaywrightRun(
  report: unknown,
  run: PlaywrightRunResult
): PlaywrightRunEvidence {
  const summary = parsePlaywrightJsonReport(report);
  const errors = [...summary.errors];
  if (run.status === 'failed' && run.stderr?.trim() && !errors.includes(run.stderr.trim())) {
    errors.push(run.stderr.trim());
  }
  return {
    status: run.status === 'failed' || summary.failed > 0 ? 'failed' : 'passed',
    ...summary,
    errors
  };
}

export function resolvePlaywrightSuite(value: unknown): { label: string; grep?: string } {
  if (typeof value !== 'string') return { label: 'all' };
  const label = value
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 120);
  if (!label || label.toLowerCase() === 'all' || label.toLowerCase() === 'smoke') {
    return { label: label.toLowerCase() === 'smoke' ? 'smoke' : 'all' };
  }
  return { label, grep: label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
}

export const PlaywrightTestGenerationRequestSchema = z
  .object({
    projectId: z.string().regex(/^_?[a-z0-9][a-z0-9-]*$/),
    approvedScenarioPaths: z.array(z.string().min(1)).min(1),
    outputDirectory: z.string().regex(/^projects\/[^/]+\/tests(?:\/|$)/),
    traceability: z.record(z.string(), z.array(z.string().min(1))).default({})
  })
  .strict();
export type PlaywrightTestGenerationRequest = z.infer<typeof PlaywrightTestGenerationRequestSchema>;

export interface PlaywrightRunRequest {
  workspace: string;
  projectId: string;
  targetBaseUrl: string;
  reportPath: string;
  grep?: string;
  testPaths?: string[];
  webServer?: { command: string; url: string };
  signal?: AbortSignal;
}

export interface PlaywrightRunResult {
  status: 'passed' | 'failed';
  exitCode: number;
  stderr?: string;
}

export interface PlaywrightRunner {
  run(request: PlaywrightRunRequest): Promise<PlaywrightRunResult>;
}

interface SpawnedProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill(signal?: NodeJS.Signals): boolean | void;
}

export type PlaywrightSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: ['ignore', 'pipe', 'pipe'];
  }
) => SpawnedProcess;

export class SpawnPlaywrightRunner implements PlaywrightRunner {
  constructor(private readonly spawn: PlaywrightSpawn = nodeSpawn as unknown as PlaywrightSpawn) {}

  run(request: PlaywrightRunRequest): Promise<PlaywrightRunResult> {
    const projectTestsPath = `projects/${request.projectId}/tests`;
    const testPaths = request.testPaths?.length ? request.testPaths : [projectTestsPath];
    if (
      testPaths.some(
        (path) =>
          (path !== projectTestsPath && !path.startsWith(`${projectTestsPath}/`)) ||
          path.includes('..') ||
          (path !== projectTestsPath && !path.endsWith('.spec.ts'))
      )
    ) {
      throw new Error('Playwright test path is outside the selected project');
    }
    const jsonOutputName = isAbsolute(request.reportPath)
      ? relative(request.workspace, request.reportPath) || request.reportPath
      : request.reportPath;
    const args = [
      join(request.workspace, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      ...testPaths
    ];
    if (request.grep) args.push('--grep', request.grep);
    return new Promise((resolve) => {
      const child = this.spawn(process.execPath, args, {
        cwd: request.workspace,
        env: {
          ...process.env,
          QALI_TARGET_BASE_URL: request.targetBaseUrl,
          PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutputName,
          PLAYWRIGHT_HTML_REPORT: 'playwright-report',
          ...(request.webServer
            ? {
                QALI_WEB_SERVER_COMMAND: request.webServer.command,
                QALI_WEB_SERVER_URL: request.webServer.url
              }
            : {})
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const persistJsonReport = (): void => {
        if (existsSync(request.reportPath)) return;
        const trimmed = stdout.trim();
        if (!trimmed.startsWith('{')) return;
        try {
          JSON.parse(trimmed);
        } catch {
          return;
        }
        mkdirSync(dirname(request.reportPath), { recursive: true });
        writeFileSync(request.reportPath, trimmed);
      };
      const finish = (result: PlaywrightRunResult): void => {
        if (settled) return;
        settled = true;
        persistJsonReport();
        request.signal?.removeEventListener('abort', cancel);
        resolve(result);
      };
      const cancel = (): void => {
        child.kill('SIGTERM');
        finish({ status: 'failed', exitCode: 1, stderr: 'cancelled' });
      };
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.on('error', (error) =>
        finish({ status: 'failed', exitCode: 1, stderr: error.message })
      );
      child.on('close', (code) =>
        finish({
          status: code === 0 ? 'passed' : 'failed',
          exitCode: code ?? 1,
          ...(stderr.trim() ? { stderr: stderr.trim() } : {})
        })
      );
      request.signal?.addEventListener('abort', cancel, { once: true });
      if (request.signal?.aborted) cancel();
    });
  }
}

export class FakePlaywrightRunner implements PlaywrightRunner {
  readonly requests: PlaywrightRunRequest[] = [];
  constructor(public results: PlaywrightRunResult[] = []) {}
  async run(request: PlaywrightRunRequest): Promise<PlaywrightRunResult> {
    this.requests.push(request);
    return this.results.shift() ?? { status: 'passed', exitCode: 0 };
  }
}
