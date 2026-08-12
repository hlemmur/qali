import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURSOR_MODEL,
  WORKER_SECRET_KEYS,
  parseDotEnv,
  parseEnvSyncGroups,
  selectActionsConfigToSync,
  selectSecretsToSync
} from './worker-secrets.js';

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

  it('parses multiline double-quoted values such as PEM private keys', () => {
    expect(
      parseDotEnv(`
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
line-one
line-two
-----END PRIVATE KEY-----"
GITHUB_APP_ID=123
`)
    ).toEqual({
      GITHUB_APP_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\nline-one\nline-two\n-----END PRIVATE KEY-----',
      GITHUB_APP_ID: '123'
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

describe('GitHub Actions env sync helpers', () => {
  it('maps .env Cursor + callback values onto Actions secrets and variables', () => {
    const decision = selectActionsConfigToSync({
      CURSOR_API_KEY: 'key-123',
      CURSOR_MODEL: 'composer-2.5',
      GITHUB_WEBHOOK_SECRET: 'hook-secret',
      WORKER_BASE_URL: 'https://qali-slack-control.example.workers.dev',
      QALI_PUBLISH_GITHUB_TOKEN: 'ghp_publish',
      GITHUB_OWNER: 'hlemmur',
      GITHUB_REPO: 'qali'
    });

    expect(decision.repo).toBe('hlemmur/qali');
    expect(decision.secrets).toEqual([
      { name: 'CURSOR_API_KEY', value: 'key-123' },
      { name: 'QALI_CALLBACK_SECRET', value: 'hook-secret' },
      { name: 'QALI_PUBLISH_GITHUB_TOKEN', value: 'ghp_publish' }
    ]);
    expect(decision.variables).toEqual([
      { name: 'CURSOR_MODEL', value: 'composer-2.5' },
      {
        name: 'QALI_WORKER_BASE_URL',
        value: 'https://qali-slack-control.example.workers.dev'
      }
    ]);
    expect(decision.skipped).toEqual([]);
  });

  it('defaults CURSOR_MODEL to composer-2.5 when the API key is set and model is blank', () => {
    expect(DEFAULT_CURSOR_MODEL).toBe('composer-2.5');
    const decision = selectActionsConfigToSync(
      {
        CURSOR_API_KEY: 'key-123',
        CURSOR_MODEL: '',
        GITHUB_OWNER: 'hlemmur',
        GITHUB_REPO: 'qali'
      },
      { only: ['cursor'] }
    );

    expect(decision.secrets).toEqual([{ name: 'CURSOR_API_KEY', value: 'key-123' }]);
    expect(decision.variables).toEqual([{ name: 'CURSOR_MODEL', value: 'composer-2.5' }]);
  });

  it('skips Actions sync when owner/repo are missing', () => {
    expect(() =>
      selectActionsConfigToSync({
        CURSOR_API_KEY: 'key-123',
        CURSOR_MODEL: 'composer-2.5'
      })
    ).toThrow(/GITHUB_OWNER/);
  });

  it('parses sync group selectors for Worker and Actions targets', () => {
    expect(parseEnvSyncGroups(undefined)).toEqual({
      worker: ['slack', 'github'],
      actions: ['actions']
    });
    expect(parseEnvSyncGroups('slack,cursor')).toEqual({
      worker: ['slack'],
      actions: ['cursor']
    });
    expect(() => parseEnvSyncGroups('cloudflare')).toThrow(/Unknown sync group/);
  });
});
