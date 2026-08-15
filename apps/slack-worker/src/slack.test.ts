import { describe, expect, it } from 'vitest';
import { SLACK_BUTTON_VALUE_MAX, slackExpandValue } from './slack.js';

describe('Slack run card control values', () => {
  it('keeps Expand button values under Slack’s 2000-character limit', () => {
    const titles = [
      'adds a product to the cart from inventory @smoke',
      'displays username, password, and login controls on the login page @regression',
      'JRN-001 generated scenario @smoke',
      'rejects empty username and password @regression',
      'rejects invalid password for standard_user @regression',
      'rejects locked out account before inventory @smoke',
      'rejects locked_out_user and does not reach inventory @regression',
      'rejects unknown username @regression',
      'requires password before login @regression',
      'requires username before login @regression',
      'retains username input after failed login @regression',
      'signs in with named demo account and reaches inventory @smoke',
      'signs in with problem_user alternate demo account @regression'
    ];
    const value = slackExpandValue(
      {
        requestId: 'Ev0BR9U3GY3S',
        status: 'passed',
        createdAt: '2026-08-15T14:00:00.000Z',
        updatedAt: '2026-08-15T14:00:00.000Z',
        teamId: 'T1',
        channelId: 'C1',
        userId: 'U1',
        threadTs: '1.1',
        requestTs: '1.1'
      },
      {
        runId: '31888505512',
        status: 'passed',
        intent: 'generate-test-suite',
        projectId: 'sauce-demo',
        htmlUrl: 'https://github.com/hlemmur/qali/actions/runs/31888505512',
        reportUrl:
          'https://qali-slack-control.qali-lab.workers.dev/reports/sauce-demo/31888505512.html?exp=1788000000&sig=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        specUrl:
          'https://github.com/hlemmur/qali/tree/6001a6240aa71a357dab4f23f723efe12078f143/projects/sauce-demo/tests/generated',
        generatedTests: { count: 14, area: 'sauce-demo', titles },
        generation: {
          focus: 'smoke',
          coverageExcerpt: '# Coverage Map\n'.repeat(20),
          files: titles.map((title, index) => ({
            path: `tests/generated/case-${index}.spec.ts`,
            title
          }))
        },
        stages: { execution: 'passed', publication: 'passed' }
      } as Parameters<typeof slackExpandValue>[1]
    );
    expect(value.length).toBeLessThanOrEqual(SLACK_BUTTON_VALUE_MAX);
    const parsed = JSON.parse(value) as {
      summary: {
        generation?: { focus?: string; files?: unknown };
        generatedTests?: { titles?: string[] };
      };
    };
    expect(parsed.summary.generation).toEqual({ focus: 'smoke' });
    expect(parsed.summary.generatedTests?.titles?.length ?? 0).toBeLessThanOrEqual(5);
  });
});
