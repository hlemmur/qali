import { describe, expect, it } from 'vitest';
import {
  displayRunStatus,
  renderRunReport,
  renderSlackRunDetails,
  renderSlackRunSummary
} from './index.js';

const result = {
  runId: 'demo-run',
  status: 'passed' as const,
  intent: 'run-test-suite',
  projectId: '_demo',
  total: 3,
  passed: 2,
  failed: 0,
  skipped: 1,
  durationMs: 1250,
  evidence: ['projects/_demo/observations/evidence/test-runs/results.json'],
  errors: [],
  tests: [
    { title: 'login.spec.ts › shows inventory', status: 'passed' },
    { title: 'checkout.spec.ts › skips empty cart', status: 'skipped' }
  ]
};

describe('compact run reporting', () => {
  it('renders only essential evidence-backed counts and actions by default', () => {
    const payload = renderSlackRunSummary(result, {
      detailsUrl: 'https://example.test/runs/demo-run',
      rerunValue: 'demo-run',
      expandValue: 'demo-run',
      triageValue: 'demo-run'
    });

    expect(payload.text).toContain('2 passed');
    expect(payload.text).toContain('0 failed');
    expect(payload.text).not.toMatch(/success success/);
    expect(JSON.stringify(payload.blocks)).not.toContain('Duration:');
    expect(JSON.stringify(payload.blocks)).not.toContain('Evidence:');
    expect(JSON.stringify(payload.blocks)).toContain('run-test-suite');
    expect(payload.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'section' }),
        expect.objectContaining({
          type: 'actions',
          elements: expect.arrayContaining([
            expect.objectContaining({
              action_id: 'open_run_url',
              url: 'https://example.test/runs/demo-run',
              text: expect.objectContaining({ text: 'GitHub' })
            }),
            expect.objectContaining({ action_id: 'expand_run_details' }),
            expect.objectContaining({ action_id: 'rerun_workflow' })
          ])
        })
      ])
    );
    expect(JSON.stringify(payload.blocks)).not.toContain('open_report');
    expect(JSON.stringify(payload.blocks)).not.toContain('triage_failures');
  });

  it('adds an Open report link button when a hosted report URL is present', () => {
    const payload = renderSlackRunSummary(result, {
      reportUrl:
        'https://qali-slack-control.example.workers.dev/reports/sauce-demo/demo-run.html?exp=1&sig=abc',
      detailsUrl: 'https://example.test/runs/demo-run'
    });
    const actions = payload.blocks.find((block) => block.type === 'actions') as {
      elements: Array<Record<string, unknown>>;
    };
    expect(actions.elements[0]).toEqual(
      expect.objectContaining({
        action_id: 'open_report',
        url: 'https://qali-slack-control.example.workers.dev/reports/sauce-demo/demo-run.html?exp=1&sig=abc',
        text: expect.objectContaining({ text: 'Open report' })
      })
    );
    expect(actions.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: 'open_run_url',
          text: expect.objectContaining({ text: 'GitHub' })
        })
      ])
    );
  });

  it('offers View tests in GitHub and Retract after reverse-approval generation', () => {
    const payload = renderSlackRunSummary(
      {
        ...result,
        intent: 'generate-test-suite',
        generatedTests: { count: 8, area: 'checkout' }
      },
      {
        specUrl: 'https://github.test/hlemmur/qali/tree/main/projects/sample/tests/generated',
        retractValue: JSON.stringify({ requestId: 'Ev1', runId: 'demo-run' })
      }
    );
    expect(payload.text).toMatch(/8 tests added/i);
    const actions = payload.blocks.find((block) => block.type === 'actions') as {
      elements: Array<Record<string, unknown>>;
    };
    expect(actions.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: 'open_spec',
          url: 'https://github.test/hlemmur/qali/tree/main/projects/sample/tests/generated',
          text: expect.objectContaining({ text: 'View tests in GitHub' })
        }),
        expect.objectContaining({
          action_id: 'retract_generated_tests',
          text: expect.objectContaining({ text: 'Retract' })
        })
      ])
    );
  });

  it('hides expand/rerun/triage while a run is still in progress', () => {
    const payload = renderSlackRunSummary(
      { runId: 'running-1', status: 'in_progress' },
      {
        detailsUrl: 'https://example.test/runs/running-1',
        rerunValue: 'running-1',
        expandValue: 'running-1',
        triageValue: 'running-1'
      }
    );
    const actions = payload.blocks.find((block) => block.type === 'actions') as {
      elements: Array<Record<string, unknown>>;
    };
    expect(actions.elements).toEqual([
      expect.objectContaining({
        action_id: 'open_run_url',
        url: 'https://example.test/runs/running-1'
      })
    ]);
  });

  it('shows triage only after a failed terminal run', () => {
    const payload = renderSlackRunSummary(
      {
        runId: 'failed-1',
        status: 'completed',
        conclusion: 'failure',
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        errors: ['login.spec.ts › submits form']
      },
      { triageValue: 'failed-1', rerunValue: 'failed-1', expandValue: 'failed-1' }
    );
    expect(JSON.stringify(payload.blocks)).toContain('triage_failures');
    expect(JSON.stringify(payload.blocks)).toContain('rerun_workflow');
    expect(JSON.stringify(payload.blocks)).toContain('login.spec.ts');
  });

  it('renders verbose run details on expand and collapses cleanly', () => {
    const details = renderSlackRunDetails(result);
    expect(details.text).toContain('details');
    expect(JSON.stringify(details.blocks)).toContain('Duration: 1250 ms');
    expect(JSON.stringify(details.blocks)).toContain('results.json');

    const expanded = renderSlackRunSummary(result, {
      expandValue: 'demo-run',
      rerunValue: 'demo-run',
      expanded: true
    });
    expect(JSON.stringify(expanded.blocks)).toContain('Duration: 1250 ms');
    expect(JSON.stringify(expanded.blocks)).toContain('collapse_run_details');
  });

  it('normalizes success conclusion without duplicating status words', () => {
    expect(displayRunStatus({ status: 'completed', conclusion: 'success' })).toBe('passed');
    const payload = renderSlackRunSummary({
      runId: 'external-run',
      status: 'completed',
      conclusion: 'success'
    });
    expect(payload.text).toBe('Qali passed');
    expect(payload.text).not.toMatch(/success success/);
  });

  it('does not fabricate unavailable result counts', () => {
    const payload = renderSlackRunSummary({
      runId: 'external-run',
      status: 'running'
    });

    expect(payload.text).toBe('Qali running');
    expect(payload.text).not.toMatch(/passed|failed/);
  });

  it('renders matching Markdown and JSON reports from the same result', () => {
    const report = renderRunReport(result);

    expect(report.json).toMatchObject({ runId: 'demo-run', total: 3, passed: 2 });
    expect(report.markdown).toContain('| Passed | 2 |');
    expect(report.markdown).toContain('results.json');
    expect(report.markdown).toContain('login.spec.ts › shows inventory');
  });

  it('separates execution from publication on a terminal card', () => {
    const payload = renderSlackRunSummary({
      runId: 'explore-1',
      status: 'failed',
      intent: 'explore-project',
      projectId: '_demo',
      stages: { execution: 'passed', publication: 'failed' },
      errors: ['Work finished, but the review change could not be published.']
    });

    const body = JSON.stringify(payload.blocks);
    expect(body).toContain('Execution passed');
    expect(body).toContain('Publication failed');
    expect(body).not.toMatch(/GitHub Actions/i);
    expect(payload.text).toContain('failed');
  });
});
