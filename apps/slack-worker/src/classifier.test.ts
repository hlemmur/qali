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
  it('maps common Slack phrases to intents and defaults to sauce-demo', () => {
    expect(heuristicClassify(work('<@BOT> explore the login flow')).intent).toBe('explore-project');
    expect(heuristicClassify(work('please run the smoke suite')).intent).toBe('run-test-suite');
    expect(heuristicClassify(work('generate dashboard tests')).intent).toBe('generate-test-suite');
    expect(heuristicClassify(work('quality pulse')).projectId).toBe('sauce-demo');
    expect(heuristicClassify(work('quality pulse')).intent).toBe('quality-pulse');
    expect(heuristicClassify(work('run tests in projects/acme')).projectId).toBe('acme');
    expect(heuristicClassify(work('explore checkout and use projects/acme'))).toEqual({
      intent: 'explore-project',
      projectId: 'acme',
      focus: { classification: 'heuristic-fallback', feature: 'checkout' }
    });
  });

  it('passes depth and feature into explore and generate work', () => {
    expect(heuristicClassify(work('deep testing of checkout'))).toEqual({
      intent: 'explore-project',
      projectId: 'sauce-demo',
      focus: { classification: 'heuristic-fallback', depth: 'deep', feature: 'checkout' }
    });
    expect(heuristicClassify(work('negative testing of login'))).toMatchObject({
      intent: 'explore-project',
      focus: { depth: 'negative', feature: 'login' }
    });
    expect(heuristicClassify(work('add tests for this issue'))).toMatchObject({
      intent: 'generate-test-suite'
    });
    expect(heuristicClassify(work('generate dashboard tests'))).toMatchObject({
      intent: 'generate-test-suite',
      focus: { feature: 'dashboard' }
    });
  });

  it('keeps add-tests-for as generate even when Workers AI returns explore', async () => {
    const primary: IntentClassifier = {
      classify: async () => ({
        intent: 'explore-project',
        projectId: 'sauce-demo',
        focus: { classification: 'workers-ai' }
      })
    };
    const resilient = new ResilientIntentClassifier(primary);
    await expect(resilient.classify(work('add tests for login flow'))).resolves.toMatchObject({
      intent: 'generate-test-suite'
    });
  });

  it('treats quality questions as read-only queries instead of work', () => {
    expect(heuristicClassify(work("<@BOT> what's our current quality status?"))).toEqual({
      intent: 'query-project',
      projectId: 'sauce-demo',
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
    expect(heuristicClassify(work('should we run the smoke suite?')).intent).toBe('query-project');
    expect(heuristicClassify(work('what is the next charter?'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'schedule' }
    });
    expect(heuristicClassify(work('more details on the last run'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'history' }
    });
    expect(heuristicClassify(work('ingest this product doc into sources'))).toMatchObject({
      intent: 'maintain-knowledge'
    });
    expect(heuristicClassify(work('ingest this observation from login'))).toMatchObject({
      intent: 'explore-project'
    });
    expect(heuristicClassify(work('proposed journey: checkout as a guest'))).toMatchObject({
      intent: 'explore-project'
    });
    expect(
      heuristicClassify(work('add tests for https://github.com/hlemmur/qali/issues/12'))
    ).toMatchObject({
      intent: 'generate-test-suite',
      focus: { issue: 'https://github.com/hlemmur/qali/issues/12' }
    });
    expect(heuristicClassify(work('repair the suite for flaky selector'))).toMatchObject({
      intent: 'maintain-suite'
    });
  });

  it('maps pause, resume, and timed regression requests to maintain-schedule', () => {
    expect(heuristicClassify(work('@Qali pause all test activities'))).toMatchObject({
      intent: 'maintain-schedule',
      focus: { action: 'pause' }
    });
    expect(heuristicClassify(work('resume testing'))).toMatchObject({
      intent: 'maintain-schedule',
      focus: { action: 'resume' }
    });
    expect(heuristicClassify(work('schedule full regression for 04:00'))).toMatchObject({
      intent: 'maintain-schedule',
      focus: { action: 'upsert-job', workflowId: 'run-test-suite', cron: '0 4 * * *' }
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

  it('maps an onboard URL onto sauce-demo and a hostname slug', () => {
    expect(heuristicClassify(work('@Qali onboard https://www.saucedemo.com'))).toEqual({
      intent: 'onboard-project',
      projectId: 'sauce-demo',
      focus: {
        classification: 'heuristic-fallback',
        targetUrl: 'https://www.saucedemo.com/',
        origin: 'https://www.saucedemo.com'
      }
    });
    expect(heuristicClassify(work('onboard https://example.com'))).toMatchObject({
      intent: 'onboard-project',
      projectId: 'example-com',
      focus: { targetUrl: 'https://example.com/', origin: 'https://example.com' }
    });
  });

  it('treats Slack thread follow-ups after exploration as generate, report, or clarify', () => {
    const afterExplore = (text: string): InboundWork => ({
      ...work(text),
      threadContext: {
        priorIntent: 'explore-project',
        priorFeature: 'login',
        requestId: 'EvExplore'
      }
    });
    expect(heuristicClassify(afterExplore('go ahead and generate tests from this'))).toMatchObject({
      intent: 'generate-test-suite',
      focus: { feature: 'login', sourceRequestId: 'EvExplore' }
    });
    expect(heuristicClassify(afterExplore('report the issues'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'history', feature: 'login' }
    });
    expect(heuristicClassify(afterExplore('can you clarify the assumptions?'))).toMatchObject({
      intent: 'query-project',
      focus: { topic: 'expected', feature: 'login' }
    });
  });

  it('keeps generate-from-exploration even when Workers AI returns explore', async () => {
    const primary: IntentClassifier = {
      classify: async () => ({
        intent: 'explore-project',
        projectId: 'sauce-demo',
        focus: { classification: 'workers-ai' }
      })
    };
    const resilient = new ResilientIntentClassifier(primary);
    await expect(
      resilient.classify({
        ...work('generate tests from this'),
        threadContext: { priorIntent: 'explore-project', priorFeature: 'login' }
      })
    ).resolves.toMatchObject({
      intent: 'generate-test-suite',
      focus: { feature: 'login' }
    });
  });
});
