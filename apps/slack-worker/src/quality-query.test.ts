import { describe, expect, it } from 'vitest';
import type { QualitySnapshot } from '@qali/contracts';
import { formatQualityQueryAnswer, mergeQualitySnapshot } from './quality-query.js';

const snapshot: QualitySnapshot = {
  version: 1,
  projectId: '_demo',
  updatedAt: '2026-08-13T12:00:00.000Z',
  lastRun: {
    intent: 'run-test-suite',
    requestId: 'Ev1',
    finishedAt: '2026-08-13T11:00:00.000Z',
    status: 'passed',
    counts: { total: 2, passed: 2, failed: 0, skipped: 0 }
  },
  coverage: { approvedScenarios: 1, automatedTests: 1, percent: 100 },
  journeys: ['JRN-001: Review account activity', 'JRN-002: Reject invalid credentials'],
  openQuestions: [],
  knownIssues: [],
  expectedResults: ['Login shows the dashboard for seeded credentials'],
  schedules: [{ workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }]
};

describe('quality query answers', () => {
  it('answers status, last regression, coverage, and schedule from a snapshot', () => {
    expect(formatQualityQueryAnswer(snapshot, { topic: 'status' })).toContain('run-test-suite');
    expect(formatQualityQueryAnswer(snapshot, { topic: 'history' })).toContain(
      '2026-08-13T11:00:00.000Z'
    );
    expect(formatQualityQueryAnswer(snapshot, { topic: 'coverage' })).toContain('1/1');
    expect(formatQualityQueryAnswer(snapshot, { topic: 'schedule' })).toContain('17 6 * * *');
    expect(formatQualityQueryAnswer(null)).toMatch(/without running Playwright/i);
  });

  it('merges last-run facts into an existing snapshot', () => {
    const merged = mergeQualitySnapshot(snapshot, {
      projectId: '_demo',
      updatedAt: '2026-08-13T13:00:00.000Z',
      lastRun: {
        intent: 'explore-project',
        finishedAt: '2026-08-13T13:00:00.000Z',
        status: 'passed'
      }
    });
    expect(merged.lastRun?.intent).toBe('explore-project');
    expect(merged.coverage?.percent).toBe(100);
    expect(merged.schedules?.[0]?.cron).toBe('17 6 * * *');
  });
});
