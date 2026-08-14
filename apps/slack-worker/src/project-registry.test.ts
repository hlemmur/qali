import type { ClassifiedIntent, ProjectExecutionProfile, ProjectRegistry } from '@qali/contracts';
import { describe, expect, it } from 'vitest';
import { resolveExecutionTarget, resolveTrustedCommand } from '@qali/project-config';
import type { InboundWork } from './types.js';

const registry: ProjectRegistry = {
  version: 1,
  projects: [
    {
      id: '_demo',
      root: 'projects/_demo',
      githubEnvironment: 'qali-demo',
      allowedSlack: {
        teamIds: ['T1'],
        channelIds: ['C1'],
        userIds: ['U1'],
        roles: ['developer', 'qa-lead-admin']
      },
      publication: { owner: 'hlemmur', repo: 'qali', branch: 'main', reviewOnly: true },
      enabledWorkflows: ['onboard-project', 'explore-project', 'run-test-suite'],
      schedules: [],
      activeExecutionProfile: 'demo-mock'
    }
  ]
};

const profile = (environmentLabel: ProjectExecutionProfile['environmentLabel']) =>
  ({
    version: 1,
    id: environmentLabel === 'mock' ? 'demo-mock' : `demo-${environmentLabel}`,
    projectId: '_demo',
    environmentLabel,
    targetVariables: {
      baseUrl: 'QALI_TARGET_BASE_URL',
      allowedOrigins: 'QALI_ALLOWED_ORIGINS_JSON',
      credentials: 'QALI_TEST_CREDENTIALS_JSON',
      testData: 'QALI_TEST_DATA_JSON'
    },
    browser: {
      name: 'chromium',
      allowDownloads: false,
      allowPopups: false,
      allowedSubmissions: [{ role: 'button', name: 'Sign in' }]
    },
    rate: { maxActionsPerMinute: 60 },
    mutation: { allowed: ['append-observation', 'append-evidence'] },
    cleanup: { strategy: 'fixture-reset' },
    redaction: { patterns: [] },
    retention: { evidenceDays: 14 },
    publication: { reviewOnly: true },
    ...(environmentLabel === 'mock' ? { displayBadge: 'MOCK MODE' } : {})
  }) satisfies ProjectExecutionProfile;

const work: InboundWork = {
  identity: 'slack:event:E1',
  requestId: 'E1',
  kind: 'message',
  text: 'explore login',
  requestedBy: 'U1',
  externalRole: 'developer',
  receivedAt: '2026-08-12T12:00:00.000Z',
  slack: { teamId: 'T1', channelId: 'C1', threadTs: '1.1', requestTs: '1.1' }
};

describe('trusted project resolution', () => {
  it('hydrates trusted metadata only after classification', () => {
    const classification: ClassifiedIntent = {
      intent: 'explore-project',
      projectId: '_demo',
      focus: { area: 'login' }
    };
    const command = resolveTrustedCommand(classification, work, registry, [profile('mock')]);

    expect(command.project).toEqual({
      id: '_demo',
      root: 'projects/_demo',
      environment: 'qali-demo',
      environmentLabel: 'mock',
      executionProfileId: 'demo-mock',
      publication: { owner: 'hlemmur', repo: 'qali', branch: 'main', reviewOnly: true },
      displayBadge: 'MOCK MODE'
    });
    expect(command.parameters).toEqual({ area: 'login' });
  });

  it.each<
    [
      {
        projectId?: ClassifiedIntent['projectId'];
        intent?: ClassifiedIntent['intent'];
        work?: InboundWork;
      },
      string
    ]
  >([
    [{ projectId: 'unknown' }, 'Unknown project'],
    [{ intent: 'quality-pulse' }, 'not enabled'],
    [{ work: { ...work, requestedBy: 'U2' } }, 'not authorized'],
    [{ work: { ...work, slack: { ...work.slack, channelId: 'C2' } } }, 'not authorized']
  ])('fails closed for untrusted project access %#', (override, message) => {
    const classification: ClassifiedIntent = {
      intent: 'explore-project',
      projectId: '_demo',
      focus: {},
      ...(override.projectId ? { projectId: override.projectId } : {}),
      ...(override.intent ? { intent: override.intent } : {})
    };
    expect(() =>
      resolveTrustedCommand(classification, override.work ?? work, registry, [profile('mock')])
    ).toThrow(message);
  });

  it('authorizes ops-channel requests for a registered project', () => {
    const command = resolveTrustedCommand(
      { intent: 'explore-project', projectId: '_demo', focus: {} },
      { ...work, slack: { ...work.slack, channelId: 'C_OPS' }, externalRole: 'qa-lead-admin' },
      registry,
      [profile('mock')],
      { opsChannelIds: ['C_OPS'] }
    );
    expect(command.project.id).toBe('_demo');
    expect(command.slack?.channelId).toBe('C_OPS');
  });

  it('dispatches onboard-project for a new hostname slug using the requesting channel as donor', () => {
    const command = resolveTrustedCommand(
      {
        intent: 'onboard-project',
        projectId: 'example-com',
        focus: { targetUrl: 'https://example.com/', origin: 'https://example.com' }
      },
      work,
      registry,
      [profile('mock')]
    );
    expect(command.project).toMatchObject({
      id: 'example-com',
      root: 'projects/example-com',
      environment: 'qali-example-com',
      environmentLabel: 'production',
      executionProfileId: 'example-com-production'
    });
    expect(command.parameters).toEqual({
      targetUrl: 'https://example.com/',
      origin: 'https://example.com'
    });
  });

  it('rejects missing or mismatched execution profiles', () => {
    expect(() =>
      resolveTrustedCommand(
        { intent: 'explore-project', projectId: '_demo', focus: {} },
        work,
        registry,
        []
      )
    ).toThrow('Missing execution profile');
    expect(() =>
      resolveTrustedCommand(
        { intent: 'explore-project', projectId: '_demo', focus: {} },
        work,
        registry,
        [{ ...profile('mock'), projectId: 'other' }]
      )
    ).toThrow('does not belong');
  });
});

describe('execution target resolution', () => {
  it.each(['mock', 'staging', 'production'] as const)(
    'uses the same variable interface for %s',
    (label) => {
      const target = resolveExecutionTarget(profile(label), {
        QALI_TARGET_BASE_URL: 'https://app.example.test/login',
        QALI_ALLOWED_ORIGINS_JSON: '["https://app.example.test"]',
        QALI_TEST_CREDENTIALS_JSON: '{"primary":"secret-ref"}',
        QALI_TEST_DATA_JSON: '{"account":"fixture-1"}'
      });
      expect(target).toMatchObject({
        environmentLabel: label,
        baseUrl: 'https://app.example.test/login',
        allowedOrigins: ['https://app.example.test'],
        browser: {
          name: 'chromium',
          allowedSubmissions: [{ role: 'button', name: 'Sign in' }]
        }
      });
    }
  );

  it('rejects missing, malformed, and unsafe target variables', () => {
    expect(() => resolveExecutionTarget(profile('mock'), {})).toThrow(
      'Missing QALI_TARGET_BASE_URL'
    );
    expect(() =>
      resolveExecutionTarget(profile('mock'), {
        QALI_TARGET_BASE_URL: 'https://evil.example.test',
        QALI_ALLOWED_ORIGINS_JSON: '["https://app.example.test"]',
        QALI_TEST_CREDENTIALS_JSON: '{}',
        QALI_TEST_DATA_JSON: '{}'
      })
    ).toThrow('not in QALI_ALLOWED_ORIGINS_JSON');
    expect(() =>
      resolveExecutionTarget(profile('mock'), {
        QALI_TARGET_BASE_URL: 'javascript:alert(1)',
        QALI_ALLOWED_ORIGINS_JSON: 'not-json',
        QALI_TEST_CREDENTIALS_JSON: '{}',
        QALI_TEST_DATA_JSON: '{}'
      })
    ).toThrow();
  });

  it('carries optional mock web-server settings from the execution profile', () => {
    const target = resolveExecutionTarget(
      {
        ...profile('mock'),
        webServer: {
          command: 'node projects/_demo/app/server.mjs',
          url: 'http://127.0.0.1:4173/health'
        }
      },
      {
        QALI_TARGET_BASE_URL: 'http://127.0.0.1:4173',
        QALI_ALLOWED_ORIGINS_JSON: '["http://127.0.0.1:4173"]',
        QALI_TEST_CREDENTIALS_JSON: '{}',
        QALI_TEST_DATA_JSON: '{}'
      }
    );
    expect(target.webServer).toEqual({
      command: 'node projects/_demo/app/server.mjs',
      url: 'http://127.0.0.1:4173/health'
    });
  });
});
