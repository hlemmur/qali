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
    expect(html).toContain('project-context.md');
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
