import { spawn as nodeSpawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { z } from 'zod';

export interface PlaywrightEvidenceSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  evidence: string[];
  errors: string[];
}

interface JsonResult {
  status?: string;
  duration?: number;
  error?: { message?: string };
  attachments?: Array<{ path?: string }>;
}

function collectTests(suite: unknown): Array<{ status?: string; results?: JsonResult[] }> {
  if (!suite || typeof suite !== 'object') return [];
  const value = suite as {
    tests?: Array<{ status?: string; results?: JsonResult[] }>;
    specs?: Array<{ tests?: Array<{ status?: string; results?: JsonResult[] }> }>;
    suites?: unknown[];
  };
  return [
    ...(value.tests ?? []),
    ...(value.specs ?? []).flatMap((spec) => spec.tests ?? []),
    ...(value.suites ?? []).flatMap(collectTests)
  ];
}

export function parsePlaywrightJsonReport(input: unknown): PlaywrightEvidenceSummary {
  const report = input as { suites?: unknown[] };
  const tests = (report.suites ?? []).flatMap(collectTests);
  const summary: PlaywrightEvidenceSummary = {
    total: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    evidence: [],
    errors: []
  };
  for (const test of tests) {
    const final = test.results?.at(-1);
    summary.durationMs +=
      test.results?.reduce((total, result) => total + (result.duration ?? 0), 0) ?? 0;
    if (test.status === 'expected' && final?.status === 'passed') summary.passed += 1;
    else if (test.status === 'skipped' || final?.status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
    for (const result of test.results ?? []) {
      if (result.error?.message) summary.errors.push(result.error.message);
      for (const attachment of result.attachments ?? []) {
        if (attachment.path) summary.evidence.push(attachment.path);
      }
    }
  }
  return summary;
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
    const args = [
      join(request.workspace, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      `projects/${request.projectId}/tests`,
      '--reporter=json'
    ];
    if (request.grep) args.push('--grep', request.grep);
    return new Promise((resolve) => {
      const child = this.spawn(process.execPath, args, {
        cwd: request.workspace,
        env: {
          ...process.env,
          QALI_TARGET_BASE_URL: request.targetBaseUrl,
          PLAYWRIGHT_JSON_OUTPUT_NAME: request.reportPath,
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
      let stderr = '';
      let settled = false;
      const finish = (result: PlaywrightRunResult): void => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener('abort', cancel);
        resolve(result);
      };
      const cancel = (): void => {
        child.kill('SIGTERM');
        finish({ status: 'failed', exitCode: 1, stderr: 'cancelled' });
      };
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
