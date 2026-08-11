import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_DEFAULTS,
  parseD1CreateOutput,
  patchWranglerDatabaseId,
  renderSlackAppManifest,
  resolveWorkerBaseUrl
} from './control-plane-setup.js';

describe('control plane setup helpers', () => {
  it('renders a Slack app manifest with Worker event and interaction URLs', () => {
    const manifest = renderSlackAppManifest('https://qali-slack-control.example.workers.dev');

    expect(manifest.display_information.name).toBe('Qali');
    expect(manifest.oauth_config.scopes.bot).toEqual([
      'app_mentions:read',
      'chat:write',
      'im:history',
      'im:write'
    ]);
    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: 'https://qali-slack-control.example.workers.dev/slack/events',
      bot_events: ['app_mention', 'message.im']
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

  it('resolves Worker URLs from overrides and Cloudflare defaults', () => {
    expect(resolveWorkerBaseUrl({ override: 'https://custom.example' })).toBe(
      'https://custom.example'
    );
    expect(
      resolveWorkerBaseUrl({
        workerName: CONTROL_PLANE_DEFAULTS.workerName,
        workersSubdomain: 'acme'
      })
    ).toBe('https://qali-slack-control.acme.workers.dev');
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
