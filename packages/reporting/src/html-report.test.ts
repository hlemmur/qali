import { describe, expect, it } from 'vitest';
import {
  describeExecutionCase,
  formatDurationMs,
  journeyGoalFromMarkdown,
  renderHtmlReport
} from './html-report.js';

const journeys = `# User Journeys

## JRN-001: Sign in and view inventory

- Actor: named demo shopper
- Goal: reach the product inventory after login
- Outcome: inventory of products is visible

## JRN-002: Add a product to the cart

- Goal: place one inventory item in the cart
`;

describe('hosted HTML report', () => {
  it('formats durations for humans', () => {
    expect(formatDurationMs(982)).toBe('982ms');
    expect(formatDurationMs(1200)).toBe('1.2s');
  });

  it('uses the journey goal as the case description when the title includes JRN-xxx', () => {
    expect(journeyGoalFromMarkdown(journeys, 'JRN-001')).toBe(
      'reach the product inventory after login'
    );
    expect(
      describeExecutionCase('functional-chromium › JRN-001 generated scenario', journeys)
    ).toEqual({
      name: 'JRN-001 generated scenario',
      description: 'reach the product inventory after login'
    });
  });

  it('renders KPI tiles, a stacked bar, and a failures-first results table', () => {
    const html = renderHtmlReport({
      runId: '42',
      status: 'failed',
      intent: 'run-test-suite',
      projectId: 'sauce-demo',
      suiteLabel: 'smoke',
      total: 4,
      passed: 3,
      failed: 1,
      skipped: 0,
      durationMs: 3400,
      stages: { execution: 'passed', publication: 'failed' },
      errors: ['Login did not reach inventory'],
      tests: [
        { title: 'login.spec.ts › shows inventory', status: 'passed', durationMs: 1200 },
        {
          title: 'checkout.spec.ts › pays with saved card',
          status: 'failed',
          error: 'Login did not reach inventory',
          durationMs: 982,
          retries: 1,
          screenshotUrl: 'https://worker.test/reports/sauce-demo/42/shot-0.png?exp=1&sig=abc',
          description: 'pay with a saved card'
        },
        { title: 'cart.spec.ts › keeps an empty cart', status: 'passed', durationMs: 400 },
        { title: 'menu.spec.ts › opens the catalog', status: 'passed', durationMs: 800 }
      ],
      evidence: ['projects/sauce-demo/observations/evidence/exploration.md']
    });

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Qali execution report');
    expect(html).toContain('sauce-demo');
    expect(html).toContain('run-test-suite');
    expect(html).toContain('Total');
    expect(html).toContain('Passed');
    expect(html).toContain('Failed');
    expect(html).toContain('Skipped');
    expect(html).toContain('Pass rate');
    expect(html).toContain('75%');
    expect(html).toContain('class="bar"');
    expect(html).toContain('<th>Status</th>');
    expect(html).toContain('<th>Case</th>');
    expect(html).toContain('<th>Description</th>');
    expect(html).toContain('<th>Duration</th>');
    expect(html).toContain('<th>Issue</th>');
    expect(html).toContain('pays with saved card');
    expect(html).toContain('shows inventory');
    expect(html).toContain('1.2s');
    expect(html).toContain('982ms');
    expect(html).toContain('Login did not reach inventory');
    expect(html).toContain('<h2>Failures</h2>');
    expect(html).toContain('pay with a saved card');
    expect(html).toContain(
      'src="https://worker.test/reports/sauce-demo/42/shot-0.png?exp=1&amp;sig=abc"'
    );
    expect(html.indexOf('pays with saved card')).toBeLessThan(html.indexOf('shows inventory'));
    expect(html).toContain('Open the GitHub run');
    expect(html).not.toContain('<script');
  });

  it('renders a structured exploration report instead of a generic non-test stub', () => {
    const html = renderHtmlReport({
      runId: 'exp-1',
      status: 'passed',
      intent: 'explore-project',
      projectId: 'sauce-demo',
      exploration: {
        focus: 'login flow',
        charter: 'Explore login flow with bounded black-box exploration.',
        budget: { maxSteps: 24, timeBudgetMs: 720_000, completedSteps: 18 },
        truncated: false,
        areas: ['login'],
        ideas: ['happy path', 'empty credentials'],
        findings: ['Login form is visible on /'],
        questions: ['Q-EXP-001 What should happen for locked users?'],
        assumptions: ['Allowlisted origin is reachable'],
        screenshotUrls: ['https://worker.test/reports/sauce-demo/exp-1/shot-0.png?exp=1&sig=abc'],
        skills: ['exploratory-testing', 'agentic-browser-testing'],
        profile: 'browser-exploration',
        timeline: [
          { action: 'Navigate /', observation: 'Login form visible', evidence: 'login.png' }
        ]
      }
    });
    expect(html).toContain('What Qali did');
    expect(html).toContain('login flow');
    expect(html).toContain('24');
    expect(html).toContain('Coverage');
    expect(html).toContain('happy path');
    expect(html).toContain('Generate smoke tests for login flow');
    expect(html).toContain('Generate regression tests for login flow');
    expect(html).not.toContain('This run did not execute Playwright tests.');
    expect(html).not.toContain('No test counts were recorded for this run.');
    expect(html).toContain('Timeline');
    expect(html).toContain('agentic-browser-testing');
    expect(html).toContain(
      'src="https://worker.test/reports/sauce-demo/exp-1/shot-0.png?exp=1&amp;sig=abc"'
    );
    expect(html).not.toContain('<script');
  });

  it('renders a generate authoring record instead of a missing Playwright KPI stub', () => {
    const html = renderHtmlReport({
      runId: 'gen-1',
      status: 'passed',
      intent: 'generate-test-suite',
      projectId: 'sauce-demo',
      generatedTests: {
        count: 2,
        area: 'sauce-demo',
        titles: ['signs in @smoke', 'pays with saved card @regression']
      },
      generation: {
        focus: 'login flow',
        coverageExcerpt: '| Scenario | Requirement |',
        files: [{ path: 'tests/generated/login.spec.ts', title: 'signs in @smoke' }],
        traceability: ['JRN-001', 'OBS-EXP-001']
      }
    });
    expect(html).toContain('What was designed');
    expect(html).toContain('What was added');
    expect(html).toContain('signs in @smoke');
    expect(html).toContain('Traceability');
    expect(html).toContain('Run the smoke suite');
    expect(html).not.toContain('No test counts were recorded for this run.');
    expect(html).not.toContain('<script');
  });

  it('renders a quality pulse session record instead of an empty KPI stub', () => {
    const html = renderHtmlReport({
      runId: 'pulse-1',
      status: 'passed',
      intent: 'quality-pulse',
      projectId: 'sauce-demo',
      qualitySnapshot: {
        lastRun: {
          intent: 'run-test-suite',
          status: 'failed',
          finishedAt: '2026-08-15T11:12:00.023Z',
          counts: { passed: 0, failed: 0, skipped: 0, total: 0 }
        },
        coverage: { approvedScenarios: 2, automatedTests: 1, percent: 50 },
        knownIssues: ['Login error banner copy is brittle'],
        openQuestions: ['Q-1 locked-user oracle'],
        schedules: [{ workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }]
      }
    });
    expect(html).toContain('Quality pulse');
    expect(html).toContain('Login error banner copy is brittle');
    expect(html).toContain('17 6 * * *');
    expect(html).not.toContain('No test counts were recorded for this run.');
    expect(html).toContain('Run smoke if the last suite failed');
  });

  it('renders a triage session record instead of an empty KPI stub', () => {
    const html = renderHtmlReport({
      runId: 'triage-1',
      status: 'passed',
      intent: 'triage-failure',
      projectId: 'sauce-demo',
      triage: {
        fingerprint: 'abc123',
        sourceRunId: 'run-9',
        failureCount: 1,
        observedStatus: 'failed',
        candidatePath: 'tests/generated/abc123.spec.ts',
        titles: ['locked user stays on login']
      }
    });
    expect(html).toContain('Fingerprint');
    expect(html).toContain('tests/generated/abc123.spec.ts');
    expect(html).toContain('locked user stays on login');
    expect(html).not.toContain('No test counts were recorded for this run.');
  });

  it('renders exploration findings that are objects without crashing HTML escape', () => {
    const html = renderHtmlReport({
      runId: 'exp-2',
      status: 'passed',
      intent: 'explore-project',
      projectId: 'sauce-demo',
      exploration: {
        focus: 'login flow',
        findings: [{ title: 'Username is required', severity: 'info' }] as unknown as string[],
        areas: [{ name: 'login' }] as unknown as string[],
        questions: [{ id: 'Q-1', text: 'What happens for locked users?' }] as unknown as string[]
      }
    });
    expect(html).toContain('Username is required');
    expect(html).not.toContain('<script');
  });

  it('explains that onboard did not execute Playwright tests', () => {
    const html = renderHtmlReport({
      runId: '99',
      status: 'failed',
      intent: 'onboard-project',
      projectId: 'sauce-demo',
      stages: { execution: 'passed', publication: 'failed' },
      errors: ['Work finished, but the review change could not be published.'],
      evidence: ['sources/project-context.md', 'sources/questions.md']
    });
    expect(html).toContain('did not execute Playwright tests');
    expect(html).not.toContain('<h2>All results</h2>');
    expect(html).toContain('What was ingested');
    expect(html).toContain('project-context.md');
    expect(html).toContain('Explore the main flow');
  });

  it('escapes untrusted error text so it cannot inject markup', () => {
    const html = renderHtmlReport({
      runId: '1',
      status: 'failed',
      errors: ['<img src=x onerror=alert(1)>']
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
