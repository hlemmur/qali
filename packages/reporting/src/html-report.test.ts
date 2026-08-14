import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from './html-report.js';

describe('hosted HTML report', () => {
  it('renders a self-contained report with summary, findings, evidence, and next actions', () => {
    const html = renderHtmlReport({
      runId: '42',
      status: 'failed',
      intent: 'explore-project',
      projectId: 'sauce-demo',
      suiteLabel: 'smoke',
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      durationMs: 3400,
      stages: { execution: 'passed', publication: 'failed' },
      errors: ['Login did not reach inventory'],
      tests: [
        { title: 'login.spec.ts › shows inventory', status: 'passed' },
        {
          title: 'checkout.spec.ts › pays with saved card',
          status: 'failed',
          error: 'Login did not reach inventory'
        }
      ],
      evidence: ['projects/sauce-demo/observations/evidence/exploration.md']
    });

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html');
    expect(html).toContain('sauce-demo');
    expect(html).toContain('explore-project');
    expect(html).toContain('Login did not reach inventory');
    expect(html).toContain('checkout.spec.ts › pays with saved card');
    expect(html).toContain('login.spec.ts › shows inventory');
    expect(html).toContain('<h2>Tests</h2>');
    expect(html).toContain('exploration.md');
    expect(html).toContain('Execution passed');
    expect(html).toContain('Open the GitHub run');
    expect(html).not.toMatch(/GitHub Actions failed before a test report was produced/i);
    expect(html).not.toContain('<script');
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
