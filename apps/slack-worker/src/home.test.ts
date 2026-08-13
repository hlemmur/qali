import { describe, expect, it } from 'vitest';
import {
  classifyHomeSection,
  homeItemsFromCorrelations,
  renderAppHome,
  type HomeItem
} from './home.js';
import type { Correlation } from './types.js';

const correlation = (overrides: Partial<Correlation> = {}): Correlation => ({
  requestId: 'Ev1',
  status: 'dispatched',
  createdAt: '2026-08-13T21:00:00.000Z',
  updatedAt: '2026-08-13T21:01:00.000Z',
  teamId: 'T1',
  channelId: 'C1',
  userId: 'U1',
  threadTs: '1.1',
  requestTs: '1.1',
  workflowId: 'explore-project',
  commandJson: JSON.stringify({
    intent: 'explore-project',
    project: { id: 'sauce-demo' }
  }),
  ...overrides
});

describe('App Home', () => {
  it('groups failed work as needs attention and dispatched work as running', () => {
    expect(classifyHomeSection('failed')).toBe('needs-attention');
    expect(classifyHomeSection('dead-lettered')).toBe('needs-attention');
    expect(classifyHomeSection('dispatched')).toBe('running');
    expect(classifyHomeSection('answered')).toBe('recent');
  });

  it('reads project and intent from the stored command', () => {
    expect(homeItemsFromCorrelations([correlation()])).toEqual([
      {
        requestId: 'Ev1',
        status: 'dispatched',
        intent: 'explore-project',
        projectId: 'sauce-demo',
        updatedAt: '2026-08-13T21:01:00.000Z'
      }
    ]);
  });

  it('renders Needs attention, Running, and Recent sections', () => {
    const items: HomeItem[] = [
      {
        requestId: 'a',
        status: 'failed',
        intent: 'run-test-suite',
        projectId: 'sauce-demo',
        updatedAt: '2026-08-13T21:02:00.000Z'
      },
      {
        requestId: 'b',
        status: 'dispatched',
        intent: 'explore-project',
        projectId: 'sauce-demo',
        updatedAt: '2026-08-13T21:01:00.000Z'
      },
      {
        requestId: 'c',
        status: 'answered',
        intent: 'query-project',
        projectId: 'sauce-demo',
        updatedAt: '2026-08-13T21:00:00.000Z'
      }
    ];
    const view = renderAppHome(items);
    expect(view.type).toBe('home');
    const text = JSON.stringify(view.blocks);
    expect(text).toContain('Needs attention');
    expect(text).toContain('Running');
    expect(text).toContain('Recent');
    expect(text).toContain('sauce-demo · run-test-suite · failed');
    expect(text).toContain('sauce-demo · explore-project · dispatched');
    expect(text).toContain('sauce-demo · query-project · answered');
  });
});
