import { describe, expect, it } from 'vitest';
import { heuristicClassify, ResilientIntentClassifier } from './classifier.js';
import type { InboundWork, IntentClassifier } from './types.js';

const work = (text: string): InboundWork => ({
  identity: 'slack:event:Ev1',
  requestId: 'Ev1',
  kind: 'message',
  text,
  requestedBy: 'U1',
  externalRole: 'developer',
  receivedAt: '2023-11-14T22:15:00.000Z',
  slack: { teamId: 'T1', channelId: 'C1', threadTs: '1.1', requestTs: '1.1' }
});

describe('intent classification fallbacks', () => {
  it('maps common Slack phrases to intents and defaults to the demo project', () => {
    expect(heuristicClassify(work('<@BOT> explore the login flow')).intent).toBe('explore-project');
    expect(heuristicClassify(work('please run the smoke suite')).intent).toBe('run-test-suite');
    expect(heuristicClassify(work('generate dashboard tests')).intent).toBe('generate-test-suite');
    expect(heuristicClassify(work('quality pulse')).projectId).toBe('_demo');
    expect(heuristicClassify(work('run tests in projects/acme')).projectId).toBe('acme');
    expect(heuristicClassify(work('explore checkout and use projects/acme'))).toEqual({
      intent: 'explore-project',
      projectId: 'acme',
      focus: { classification: 'heuristic-fallback' }
    });
  });

  it('falls back to heuristics when the primary classifier throws', async () => {
    const primary: IntentClassifier = {
      classify: async () => {
        throw new Error('AI unavailable');
      }
    };
    const resilient = new ResilientIntentClassifier(primary);
    await expect(resilient.classify(work('@Qali run smoke'))).resolves.toMatchObject({
      intent: 'run-test-suite',
      focus: { classification: 'heuristic-fallback' }
    });
  });
});
