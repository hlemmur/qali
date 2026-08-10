import { describe, expect, it } from 'vitest';
import { renderRunReport, renderSlackRunDetails, renderSlackRunSummary } from './index.js';

const result = {
  runId: 'demo-run',
  status: 'passed' as const,
  total: 3,
  passed: 2,
  failed: 0,
  skipped: 1,
  durationMs: 1250,
  evidence: ['projects/_demo/observations/evidence/test-runs/results.json'],
  errors: []
};

describe('compact run reporting', () => {
  it('renders only essential evidence-backed counts and actions by default', () => {
    const payload = renderSlackRunSummary(result, {
      detailsUrl: 'https://example.test/runs/demo-run',
      reportUrl: 'https://example.test/reports/demo-run',
      rerunValue: 'demo-run',
      triageValue: 'demo-run'
    });

    expect(payload.text).toContain('2 passed');
    expect(payload.text).toContain('0 failed');
    expect(JSON.stringify(payload.blocks)).not.toContain('Duration:');
    expect(JSON.stringify(payload.blocks)).not.toContain('Evidence:');
    expect(payload.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'section' }),
        expect.objectContaining({
          type: 'actions',
          elements: expect.arrayContaining([
            expect.objectContaining({ action_id: 'run_details' }),
            expect.objectContaining({ action_id: 'rerun_workflow' }),
            expect.objectContaining({ action_id: 'triage_failures' }),
            expect.objectContaining({ action_id: 'open_report' })
          ])
        })
      ])
    );
  });

  it('renders verbose run details separately for expansion', () => {
    const payload = renderSlackRunDetails(result);

    expect(payload.text).toContain('details');
    expect(JSON.stringify(payload.blocks)).toContain('Duration: 1250 ms');
    expect(JSON.stringify(payload.blocks)).toContain('results.json');
  });

  it('does not fabricate unavailable result counts', () => {
    const payload = renderSlackRunSummary({
      runId: 'external-run',
      status: 'running'
    });

    expect(payload.text).toBe('Qali run external-run: running');
    expect(payload.text).not.toMatch(/passed|failed/);
  });

  it('renders matching Markdown and JSON reports from the same result', () => {
    const report = renderRunReport(result);

    expect(report.json).toMatchObject({ runId: 'demo-run', total: 3, passed: 2 });
    expect(report.markdown).toContain('| Passed | 2 |');
    expect(report.markdown).toContain('results.json');
  });
});
