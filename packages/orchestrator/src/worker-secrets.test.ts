import { describe, expect, it } from 'vitest';
import { WORKER_SECRET_KEYS, parseDotEnv, selectSecretsToSync } from './worker-secrets.js';

describe('worker secret sync helpers', () => {
  it('parses dotenv values and ignores comments/blank lines', () => {
    expect(
      parseDotEnv(`
# comment
SLACK_BOT_TOKEN=xoxb-test
SLACK_SIGNING_SECRET="quoted-secret"
EMPTY=
`)
    ).toEqual({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_SIGNING_SECRET: 'quoted-secret',
      EMPTY: ''
    });
  });

  it('selects only configured Worker secrets and reports missing required ones', () => {
    const decision = selectSecretsToSync(
      {
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_SIGNING_SECRET: 'signing',
        SLACK_BOT_USER_ID: 'U123',
        GITHUB_APP_ID: '',
        WORKER_BASE_URL: 'https://example.workers.dev'
      },
      { only: ['slack'] }
    );

    expect(decision.secrets.map((entry) => entry.name)).toEqual([
      'SLACK_SIGNING_SECRET',
      'SLACK_BOT_TOKEN',
      'SLACK_BOT_USER_ID'
    ]);
    expect(decision.skipped).toEqual([]);
    expect(WORKER_SECRET_KEYS.slack).toContain('SLACK_BOT_TOKEN');
  });

  it('requires the Slack triad when syncing Slack secrets', () => {
    expect(() =>
      selectSecretsToSync({ SLACK_BOT_TOKEN: 'xoxb-test' }, { only: ['slack'] })
    ).toThrow(/SLACK_SIGNING_SECRET/);
  });
});
