import { describe, expect, it } from 'vitest';
import {
  callbackAuthenticationHeaders,
  describeRunStages,
  resolveSlackRunStatus,
  userFacingFailureDetails
} from './post-run-summary.js';

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
