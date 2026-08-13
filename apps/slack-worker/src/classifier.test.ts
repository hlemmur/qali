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
    expect(heuristicClassify(work('quality pulse')).intent).toBe('quality-pulse');
    expect(heuristicClassify(work('run tests in projects/acme')).projectId).toBe('acme');
    expect(heuristicClassify(work('explore checkout and use projects/acme'))).toEqual({
      intent: 'explore-project',
      projectId: 'acme',
      focus: { classification: 'heuristic-fallback' }
    });
  });

  it('treats quality questions as read-only queries instead of work', () => {
    expect(heuristicClassify(work("<@BOT> what's our current quality status?"))).toEqual({
      intent: 'query-project',
      projectId: '_demo',
      focus: { classification: 'heuristic-fallback', topic: 'status' }
    });
    expect(heuristicClassify(work('@Qali when was the latest full regression?'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'history' }
    });
    expect(heuristicClassify(work('what is our coverage for checkout?'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'coverage', feature: 'checkout' }
    });
    expect(heuristicClassify(work('when is the next scheduled pulse?'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'schedule' }
    });
    expect(heuristicClassify(work('what are the critical flows?'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'flows' }
    });
    expect(heuristicClassify(work('what is the expected result for login?'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'expected', feature: 'login' }
    });
    expect(heuristicClassify(work('can you run the smoke suite?')).intent).toBe('run-test-suite');
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
