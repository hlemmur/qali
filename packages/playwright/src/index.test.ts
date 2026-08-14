import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  FakePlaywrightRunner,
  PlaywrightTestGenerationRequestSchema,
  SpawnPlaywrightRunner,
  summarizePlaywrightRun,
  parsePlaywrightJsonReport,
  resolvePlaywrightSuite,
  type PlaywrightSpawn
} from './index.js';

describe('Playwright adapter', () => {
  it('normalizes project suite selection without allowing regex injection', () => {
    expect(resolvePlaywrightSuite(undefined)).toEqual({ label: 'all' });
    expect(resolvePlaywrightSuite('all')).toEqual({ label: 'all' });
    expect(resolvePlaywrightSuite('checkout.*')).toEqual({
      label: 'checkout.*',
      grep: 'checkout\\.\\*'
    });
    expect(resolvePlaywrightSuite('  ')).toEqual({ label: 'all' });
  });

  it('parses report status and failure evidence', () => {
    const report = parsePlaywrightJsonReport({
      suites: [
        {
          specs: [
            {
              title: 'login.spec.ts › shows inventory',
              tests: [
                {
                  status: 'expected',
                  results: [{ status: 'passed', duration: 120, attachments: [] }]
                }
              ]
            },
            {
              title: 'checkout.spec.ts › pays with saved card',
              tests: [
                {
                  status: 'unexpected',
                  results: [
                    {
                      status: 'failed',
                      duration: 80,
                      error: { message: 'Expected dashboard' },
                      attachments: [
                        { name: 'trace', path: 'test-results/trace.zip' },
                        { name: 'screenshot', path: 'test-results/failure.png' }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          suites: []
        }
      ]
    });
    expect(report).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      durationMs: 200,
      evidence: ['test-results/trace.zip', 'test-results/failure.png'],
      errors: ['Expected dashboard'],
      tests: [
        { title: 'login.spec.ts › shows inventory', status: 'passed' },
        {
          title: 'checkout.spec.ts › pays with saved card',
          status: 'failed',
          error: 'Expected dashboard'
        }
      ]
    });
  });

  it('preserves process failure state when the JSON report has no failed tests', () => {
    expect(
      summarizePlaywrightRun(
        { suites: [] },
        { status: 'failed', exitCode: 1, stderr: 'No tests found' }
      )
    ).toEqual({
      status: 'failed',
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      evidence: [],
      errors: ['No tests found'],
      tests: []
    });
  });

  it('does not report runner warnings as test errors when the process succeeds', () => {
    expect(
      summarizePlaywrightRun(
        {
          suites: [
            {
              specs: [
                {
                  tests: [
                    {
                      status: 'expected',
                      results: [{ status: 'passed', duration: 12 }]
                    }
                  ]
                }
              ]
            }
          ]
        },
        { status: 'passed', exitCode: 0, stderr: 'NO_COLOR is ignored' }
      )
    ).toMatchObject({ status: 'passed', passed: 1, errors: [] });
  });

  it('runs deterministic project tests without a shell', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    const spawn = vi.fn<PlaywrightSpawn>(() => child);
    const runner = new SpawnPlaywrightRunner(spawn);
    const pending = runner.run({
      workspace: '/repo',
      projectId: '_demo',
      targetBaseUrl: 'https://staging.example.test',
      reportPath: 'test-results/report.json'
    });
    queueMicrotask(() => child.emit('close', 0));

    await expect(pending).resolves.toMatchObject({ status: 'passed' });
    const [command, args, options] = spawn.mock.calls[0]!;
    expect(command).toBe(process.execPath);
    expect(args[0]).toContain('@playwright/test/cli.js');
    expect(args).toEqual(
      expect.arrayContaining(['test', 'projects/_demo/tests', '--reporter=json', '--reporter=html'])
    );
    expect(options).toMatchObject({ cwd: '/repo', shell: false });
    expect(options.env.QALI_TARGET_BASE_URL).toBe('https://staging.example.test');
    expect(options.env.PLAYWRIGHT_JSON_OUTPUT_NAME).toBe('test-results/report.json');
    expect(options.env.PLAYWRIGHT_HTML_REPORT).toBe('playwright-report');
  });

  it('scopes regression validation to explicit candidate test paths', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    const spawn = vi.fn<PlaywrightSpawn>(() => child);
    const runner = new SpawnPlaywrightRunner(spawn);
    const pending = runner.run({
      workspace: '/repo',
      projectId: 'shop',
      targetBaseUrl: 'https://staging.example.test',
      reportPath: 'test-results/regression.json',
      testPaths: ['projects/shop/tests/regressions/failure.spec.ts']
    });
    queueMicrotask(() => child.emit('close', 1));

    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    const args = spawn.mock.calls[0]![1];
    expect(args).toContain('projects/shop/tests/regressions/failure.spec.ts');
    expect(args).not.toContain('projects/shop/tests');
  });

  it('injects mock web-server env for Playwright when provided', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    const spawn = vi.fn<PlaywrightSpawn>(() => child);
    const runner = new SpawnPlaywrightRunner(spawn);
    const pending = runner.run({
      workspace: '/repo',
      projectId: '_demo',
      targetBaseUrl: 'http://127.0.0.1:4173',
      reportPath: 'test-results/report.json',
      webServer: {
        command: 'node projects/_demo/app/server.mjs',
        url: 'http://127.0.0.1:4173/health'
      }
    });
    queueMicrotask(() => child.emit('close', 0));

    await expect(pending).resolves.toMatchObject({ status: 'passed' });
    const options = spawn.mock.calls[0]![2]!;
    expect(options.env.QALI_WEB_SERVER_COMMAND).toBe('node projects/_demo/app/server.mjs');
    expect(options.env.QALI_WEB_SERVER_URL).toBe('http://127.0.0.1:4173/health');
  });

  it('terminates the Playwright process when execution is cancelled', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    const controller = new AbortController();
    const runner = new SpawnPlaywrightRunner(vi.fn<PlaywrightSpawn>(() => child));

    const pending = runner.run({
      workspace: '/repo',
      projectId: '_demo',
      targetBaseUrl: 'https://staging.example.test',
      reportPath: 'test-results/report.json',
      signal: controller.signal
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({ status: 'failed', stderr: 'cancelled' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('provides deterministic fakes and a traceable generation contract', async () => {
    expect(() =>
      PlaywrightTestGenerationRequestSchema.parse({
        projectId: '_demo',
        approvedScenarioPaths: [],
        outputDirectory: 'projects/_demo/tests'
      })
    ).toThrow();
    const fake = new FakePlaywrightRunner([{ status: 'passed', exitCode: 0 }]);
    await expect(
      fake.run({
        workspace: '/repo',
        projectId: '_demo',
        targetBaseUrl: 'http://127.0.0.1:4173',
        reportPath: 'report.json'
      })
    ).resolves.toMatchObject({ status: 'passed' });
    expect(fake.requests).toHaveLength(1);
  });
});
