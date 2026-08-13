import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProjectExecutionProfileSchema, ProjectRegistrySchema } from '@qali/contracts';

const registry = ProjectRegistrySchema.parse(
  JSON.parse(readFileSync(new URL('../../../projects/registry.json', import.meta.url), 'utf8'))
);

describe('live Slack registry', () => {
  it('maps the test channel to sauce-demo and keeps _demo out of Slack', () => {
    expect(registry.projects.map(({ id }) => id)).toEqual(['sauce-demo']);
    expect(registry.projects[0]).toMatchObject({
      id: 'sauce-demo',
      root: 'projects/sauce-demo',
      githubEnvironment: 'qali-sauce-demo',
      activeExecutionProfile: 'sauce-demo-production',
      allowedSlack: { channelIds: ['C0BPN1KEHC4'] }
    });
    const profile = ProjectExecutionProfileSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../../projects/sauce-demo/execution-profile.json', import.meta.url),
          'utf8'
        )
      )
    );
    expect(profile.environmentLabel).toBe('production');
    expect(profile.displayBadge).toBeUndefined();
    expect(profile.webServer).toBeUndefined();
  });
});
