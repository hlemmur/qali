import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  FakePlaywrightRunner,
  PlaywrightTestGenerationRequestSchema,
  SpawnPlaywrightRunner,
  parsePlaywrightJsonReport,
  type PlaywrightSpawn
} from './index.js';

describe('Playwright adapter', () => {
  it('parses report status and failure evidence', () => {
    const report = parsePlaywrightJsonReport({
      suites: [
        {
          specs: [
            {
              tests: [
                {
                  status: 'expected',
                  results: [{ status: 'passed', duration: 120, attachments: [] }]
                },
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
      errors: ['Expected dashboard']
    });
  });

  it('runs deterministic project tests without a shell', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
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
    expect(args).toEqual(expect.arrayContaining(['test', 'projects/_demo/tests']));
    expect(options).toMatchObject({ cwd: '/repo', shell: false });
    expect(options.env.QALI_TARGET_BASE_URL).toBe('https://staging.example.test');
  });

  it('injects mock web-server env for Playwright when provided', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
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
