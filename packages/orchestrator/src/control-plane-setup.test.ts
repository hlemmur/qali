import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_DEFAULTS,
  applyWorkerUrlsToSlackManifest,
  parseD1CreateOutput,
  patchWranglerDatabaseId,
  renderSlackAppManifest,
  resolveWorkerBaseUrl
} from './control-plane-setup.js';

describe('control plane setup helpers', () => {
  it('names the hosted-report R2 bucket', () => {
    expect(CONTROL_PLANE_DEFAULTS.reportsBucketName).toBe('qali-reports');
  });

  it('renders a Slack app manifest with Worker event and interaction URLs', () => {
    const manifest = renderSlackAppManifest('https://qali-slack-control.example.workers.dev');

    expect(manifest.display_information.name).toBe('Qali');
    expect(manifest.display_information.description).toMatch(/Playwright/i);
    expect(manifest.display_information.description).toMatch(/evidence/i);
    expect(manifest.display_information.description).not.toMatch(/test suits/i);
    expect(manifest.display_information.background_color).toBe('#ff0084');
    expect(manifest.oauth_config.scopes.bot).toEqual([
      'app_mentions:read',
      'chat:write',
      'im:history',
      'im:write'
    ]);
    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: 'https://qali-slack-control.example.workers.dev/slack/events',
      bot_events: ['app_mention', 'message.im', 'app_home_opened']
    });
    expect(manifest.features.app_home).toEqual({
      home_tab_enabled: true,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false
    });
    expect(manifest.settings.interactivity).toEqual({
      is_enabled: true,
      request_url: 'https://qali-slack-control.example.workers.dev/slack/interactions'
    });
    expect(manifest.settings.socket_mode_enabled).toBe(false);
  });

  it('rejects non-https Worker base URLs', () => {
    expect(() => renderSlackAppManifest('http://localhost:8787')).toThrow(/https/i);
  });

  it('keeps template branding while substituting Worker URLs from env-derived base', () => {
    const template = renderSlackAppManifest(CONTROL_PLANE_DEFAULTS.placeholderWorkerBaseUrl);
    template.display_information.description = 'Custom operator description';
    const rendered = applyWorkerUrlsToSlackManifest(
      template,
      'https://qali-slack-control.qali-lab.workers.dev'
    );
    expect(rendered.display_information.description).toBe('Custom operator description');
    expect(rendered.settings.event_subscriptions.request_url).toBe(
      'https://qali-slack-control.qali-lab.workers.dev/slack/events'
    );
    expect(rendered.settings.interactivity.request_url).toBe(
      'https://qali-slack-control.qali-lab.workers.dev/slack/interactions'
    );
  });

  it('patches only the D1 database_id in wrangler config text', () => {
    const source = `{
  "name": "qali-slack-control",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "qali-control",
      "database_id": "replace-with-production-database-id",
      "migrations_dir": "migrations"
    }
  ]
}
`;
    const patched = patchWranglerDatabaseId(source, 'abc-123-def');
    expect(patched).toContain('"database_id": "abc-123-def"');
    expect(patched).toContain('"database_name": "qali-control"');
    expect(patched).not.toContain('replace-with-production-database-id');
  });

  it('resolves Worker URLs from WORKER_BASE_URL only', () => {
    expect(resolveWorkerBaseUrl({ override: 'https://custom.example' })).toBe(
      'https://custom.example'
    );
    expect(() => resolveWorkerBaseUrl({})).toThrow(/WORKER_BASE_URL/);
  });

  it('extracts a D1 database id from wrangler create output', () => {
    expect(
      parseD1CreateOutput(`
[[d1_databases]]
binding = "DB"
database_name = "qali-control"
database_id = "11111111-2222-3333-4444-555555555555"
`)
    ).toBe('11111111-2222-3333-4444-555555555555');
  });
});
