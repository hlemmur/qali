import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyJourneyDescriptions,
  callbackAuthenticationHeaders,
  describeRunStages,
  prepareFailureScreenshots,
  publishHostedReport,
  reportTests,
  resolveSlackRunStatus,
  shouldSkipScreenshot,
  userFacingFailureDetails
} from './post-run-summary.js';

describe('reportTests', () => {
  it('keeps titled Playwright cases for the hosted HTML report', () => {
    expect(
      reportTests({
        tests: [
          { title: 'login.spec.ts › shows inventory', status: 'passed' },
          {
            title: 'checkout.spec.ts › pays with saved card',
            status: 'failed',
            error: 'Expected dashboard'
          },
          { status: 'failed' }
        ]
      })
    ).toEqual([
      { title: 'login.spec.ts › shows inventory', status: 'passed' },
      {
        title: 'checkout.spec.ts › pays with saved card',
        status: 'failed',
        error: 'Expected dashboard'
      }
    ]);
  });

  it('keeps duration, retries, file, suite, and screenshot path', () => {
    expect(
      reportTests({
        tests: [
          {
            title: 'functional-chromium › JRN-001 generated scenario',
            status: 'failed',
            error: 'timeout',
            durationMs: 982,
            retries: 1,
            file: 'projects/sauce-demo/tests/generated/jrn-001.generated.spec.ts',
            suite: 'functional-chromium',
            screenshotPath: 'test-results/failure.png'
          }
        ]
      })
    ).toEqual([
      {
        title: 'functional-chromium › JRN-001 generated scenario',
        status: 'failed',
        error: 'timeout',
        durationMs: 982,
        retries: 1,
        file: 'projects/sauce-demo/tests/generated/jrn-001.generated.spec.ts',
        suite: 'functional-chromium',
        screenshotPath: 'test-results/failure.png'
      }
    ]);
  });
});

describe('resolveSlackRunStatus', () => {
  it('overrides a passed report when the Actions job failed', () => {
    expect(resolveSlackRunStatus('failure', 'passed')).toBe('failed');
  });

  it('overrides a passed report when the Actions job was cancelled', () => {
    expect(resolveSlackRunStatus('cancelled', 'passed')).toBe('failed');
  });

  it('keeps the report status when the job succeeded', () => {
    expect(resolveSlackRunStatus('success', 'passed')).toBe('passed');
    expect(resolveSlackRunStatus('success', 'failed')).toBe('failed');
  });

  it('falls back to job outcome when no report status exists', () => {
    expect(resolveSlackRunStatus('success', undefined)).toBe('passed');
    expect(resolveSlackRunStatus('unknown', undefined)).toBe('unknown');
  });
});

describe('callbackAuthenticationHeaders', () => {
  it('binds the timestamp, nonce, and body into the callback signature', () => {
    expect(
      callbackAuthenticationHeaders(
        'callback-secret',
        '{"requestId":"Ev1"}',
        1_700_000_000,
        'run-42-attempt-1'
      )
    ).toEqual({
      'x-qali-timestamp': '1700000000',
      'x-qali-nonce': 'run-42-attempt-1',
      'x-qali-signature': 'sha256=fa6a70c5531210a353ae03aa5708b7d049fc105cf0e1fd6a2152de5991ee83da'
    });
  });
});

describe('userFacingFailureDetails', () => {
  it('never mentions GitHub Actions when a non-suite run fails without counts', () => {
    const errors = userFacingFailureDetails({
      jobStatus: 'failure',
      intent: 'explore-project',
      hasCounts: false,
      existingErrors: []
    });

    expect(errors.join(' ')).not.toMatch(/GitHub Actions/i);
    expect(errors.join(' ')).not.toMatch(/test report was produced/i);
    expect(errors[0]).toMatch(/Exploration/i);
  });

  it('explains a publication failure without kitchen language', () => {
    expect(
      userFacingFailureDetails({
        jobStatus: 'failure',
        intent: 'explore-project',
        hasCounts: false,
        existingErrors: [],
        executeResult: 'success',
        publishResult: 'failure'
      })
    ).toEqual(['Work finished, but the review change could not be published.']);
  });

  it('keeps onboard findings when publication fails', () => {
    expect(
      userFacingFailureDetails({
        jobStatus: 'failure',
        intent: 'onboard-project',
        hasCounts: false,
        existingErrors: ['Q-001 What is the project tech stack?'],
        executeResult: 'success',
        publishResult: 'failure'
      })
    ).toEqual([
      'Q-001 What is the project tech stack?',
      'Work finished, but the review change could not be published.'
    ]);
  });

  it('keeps existing user-facing errors and strips kitchen language', () => {
    expect(
      userFacingFailureDetails({
        jobStatus: 'failure',
        intent: 'run-test-suite',
        hasCounts: false,
        existingErrors: [
          'GitHub Actions failed before a test report was produced',
          'Login form did not reach the dashboard'
        ]
      })
    ).toEqual(['Login form did not reach the dashboard']);
  });

  it('maps execute and publish job results into user-facing stages', () => {
    expect(describeRunStages('success', 'failure')).toEqual({
      execution: 'passed',
      publication: 'failed'
    });
    expect(describeRunStages('failure', 'skipped')).toEqual({ execution: 'failed' });
  });
});

describe('publishHostedReport', () => {
  it('uploads HTML and returns the signed report URL', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe('https://worker.test/github/report');
      return Response.json({
        ok: true,
        reportUrl: 'https://worker.test/reports/sauce-demo/42.html?exp=1&sig=abc'
      });
    };
    await expect(
      publishHostedReport({
        workerBase: 'https://worker.test',
        secret: 'callback-secret',
        runId: '42',
        projectId: 'sauce-demo',
        html: '<!DOCTYPE html><html><body>ok</body></html>',
        nowSeconds: 1_700_000_000,
        nonce: '42:1:report',
        requestId: 'Ev1',
        fetchImpl
      })
    ).resolves.toBe('https://worker.test/reports/sauce-demo/42.html?exp=1&sig=abc');
  });

  it('skips the hosted report URL when upload fails', async () => {
    const fetchImpl: typeof fetch = async () => new Response('no bucket', { status: 503 });
    await expect(
      publishHostedReport({
        workerBase: 'https://worker.test',
        secret: 'callback-secret',
        runId: '42',
        projectId: 'sauce-demo',
        html: '<!DOCTYPE html><html></html>',
        nowSeconds: 1_700_000_000,
        nonce: '42:1:report',
        fetchImpl
      })
    ).resolves.toBeUndefined();
  });

  it('includes screenshot attachments in the hosted report upload', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        attachments?: Array<{ filename: string; data: string }>;
      };
      expect(body.attachments?.[0]?.filename).toBe('shot-0.png');
      return Response.json({
        ok: true,
        reportUrl: 'https://worker.test/reports/sauce-demo/42.html?exp=1&sig=abc'
      });
    };
    await expect(
      publishHostedReport({
        workerBase: 'https://worker.test',
        secret: 'callback-secret',
        runId: '42',
        projectId: 'sauce-demo',
        html: '<!DOCTYPE html><html><body>ok</body></html>',
        nowSeconds: 1_700_000_000,
        nonce: '42:1:report',
        attachments: [{ filename: 'shot-0.png', data: 'iVBOR' }],
        fetchImpl
      })
    ).resolves.toBe('https://worker.test/reports/sauce-demo/42.html?exp=1&sig=abc');
  });
});

describe('failure screenshots and journey copy', () => {
  it('skips screenshots that look like unmasked password fields', () => {
    expect(shouldSkipScreenshot('test-results/password-unmasked.png')).toBe(true);
    expect(shouldSkipScreenshot('test-results/test-failed-1.png')).toBe(false);
  });

  it('uses the journey goal as the case description', () => {
    expect(
      applyJourneyDescriptions(
        [{ title: 'functional-chromium › JRN-001 generated scenario', status: 'passed' }],
        '## JRN-001: Sign in\n\n- Goal: reach the product inventory after login\n'
      )[0]?.description
    ).toBe('reach the product inventory after login');
  });

  it('signs failed-test screenshots for the hosted report', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-shots-'));
    const shot = join(workspace, 'failure.png');
    writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const prepared = await prepareFailureScreenshots({
      tests: [
        {
          title: 'checkout failed',
          status: 'failed',
          screenshotPath: 'failure.png'
        }
      ],
      workspace,
      projectId: 'sauce-demo',
      runId: '42',
      workerBase: 'https://worker.test',
      secret: 'callback-secret',
      expiresAtSeconds: 1_700_000_100
    });
    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.attachments[0]?.filename).toBe('shot-0.png');
    expect(prepared.tests[0]?.screenshotUrl).toContain('/reports/sauce-demo/42/shot-0.png');
  });
});
