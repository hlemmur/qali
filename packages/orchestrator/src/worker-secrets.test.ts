import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURSOR_MODEL,
  WORKER_SECRET_KEYS,
  parseDotEnv,
  parseEnvSyncGroups,
  syncGitHubEnvironmentConfig,
  selectActionsConfigToSync,
  selectPublicationEnvironmentConfigToSync,
  selectProjectEnvironmentConfigToSync,
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
  it('provisions a GitHub Environment before installing its values', () => {
    const operations: string[] = [];

    const count = syncGitHubEnvironmentConfig(
      'hlemmur/qali',
      {
        environment: 'qali-publication',
        secrets: [{ name: 'QALI_PUBLISH_GITHUB_TOKEN', value: 'token' }],
        variables: [{ name: 'QALI_TARGET_BASE_URL', value: 'https://example.test' }]
      },
      {
        ensureEnvironment: (repo, environment) => operations.push(`ensure:${repo}:${environment}`),
        setSecret: (_repo, environment, secret) =>
          operations.push(`secret:${environment}:${secret.name}`),
        setVariable: (_repo, environment, variable) =>
          operations.push(`variable:${environment}:${variable.name}`)
      }
    );

    expect(operations).toEqual([
      'ensure:hlemmur/qali:qali-publication',
      'secret:qali-publication:QALI_PUBLISH_GITHUB_TOKEN',
      'variable:qali-publication:QALI_TARGET_BASE_URL'
    ]);
    expect(count).toBe(2);
  });

  it('selects the standard target interface for a named GitHub Environment', () => {
    expect(
      selectProjectEnvironmentConfigToSync(
        {
          QALI_TARGET_BASE_URL: 'http://127.0.0.1:4173',
          QALI_ALLOWED_ORIGINS_JSON: '["http://127.0.0.1:4173"]',
          QALI_TEST_CREDENTIALS_JSON: '{}',
          QALI_TEST_DATA_JSON: '{}'
        },
        'qali-demo'
      )
    ).toEqual({
      environment: 'qali-demo',
      secrets: [{ name: 'QALI_TEST_CREDENTIALS_JSON', value: '{}' }],
      variables: [
        { name: 'QALI_TARGET_BASE_URL', value: 'http://127.0.0.1:4173' },
        {
          name: 'QALI_ALLOWED_ORIGINS_JSON',
          value: '["http://127.0.0.1:4173"]'
        },
        { name: 'QALI_TEST_DATA_JSON', value: '{}' }
      ]
    });
    expect(() => selectProjectEnvironmentConfigToSync({}, 'qali-demo')).toThrow(
      'QALI_TARGET_BASE_URL'
    );
  });

  it('maps .env Cursor + callback values onto Actions secrets and variables', () => {
    const decision = selectActionsConfigToSync({
      CURSOR_API_KEY: 'key-123',
      CURSOR_MODEL: 'composer-2.5',
      GITHUB_WEBHOOK_SECRET: 'hook-secret',
      QALI_CALLBACK_SECRET: 'callback-secret',
      WORKER_BASE_URL: 'https://qali-slack-control.example.workers.dev',
      QALI_PUBLISH_GITHUB_TOKEN: 'ghp_publish',
      GITHUB_OWNER: 'hlemmur',
      GITHUB_REPO: 'qali'
    });

    expect(decision.repo).toBe('hlemmur/qali');
    expect(decision.secrets).toEqual([
      { name: 'CURSOR_API_KEY', value: 'key-123' },
      { name: 'QALI_CALLBACK_SECRET', value: 'callback-secret' }
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

  it('scopes the publication token to its dedicated GitHub Environment', () => {
    expect(
      selectPublicationEnvironmentConfigToSync({
        QALI_PUBLISH_GITHUB_TOKEN: 'ghp_publish'
      })
    ).toEqual({
      environment: 'qali-publication',
      secrets: [{ name: 'QALI_PUBLISH_GITHUB_TOKEN', value: 'ghp_publish' }],
      variables: []
    });
  });

  it('never derives the Actions callback secret from the webhook secret', () => {
    const decision = selectActionsConfigToSync({
      GITHUB_WEBHOOK_SECRET: 'hook-secret',
      GITHUB_OWNER: 'hlemmur',
      GITHUB_REPO: 'qali'
    });

    expect(decision.secrets).not.toContainEqual({
      name: 'QALI_CALLBACK_SECRET',
      value: 'hook-secret'
    });
    expect(decision.skipped).toContain('QALI_CALLBACK_SECRET');
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
