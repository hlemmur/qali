import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const requiredDocs = [
  'README.md',
  'docs/architecture.md',
  'docs/setup-slack.md',
  'docs/setup-github.md',
  'docs/autonomy-and-security.md',
  'docs/project-template.md',
  'docs/roadmap.md',
  '.env.example'
];
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

describe('product documentation assets', () => {
  it('ships every required setup, architecture, security, template, and roadmap document', () => {
    expect(() => requiredDocs.map(read)).not.toThrow();
  });

  it('documents the exact verified local commands and Mock Mode status', () => {
    const readme = read('README.md');
    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    for (const command of ['check', 'demo:test', 'demo:loop']) {
      expect(scripts.scripts[command]).toBeDefined();
      expect(readme).toContain(`npm run ${command}`);
    }
    expect(readme).toContain('[MOCK MODE]');
    expect(readme).toMatch(/not (?:been )?deployed/i);
    expect(readme).toMatch(/no preview URL/i);
  });

  it('keeps documented role and credential configuration consistent with the runtime', () => {
    const combined = requiredDocs.map(read).join('\n');
    for (const name of [
      'SLACK_QA_LEAD_USER_IDS',
      'SLACK_ALLOWED_USER_IDS',
      'QALI_PUBLISH_GITHUB_TOKEN',
      'GITHUB_APP_ID',
      'GITHUB_INSTALLATION_ID'
    ]) {
      expect(read('.env.example')).toContain(name);
      expect(combined).toContain(name);
    }
    expect(combined).toMatch(/Developer/);
    expect(combined).toMatch(/QA Lead\/Admin/);
  });

  it('contains no workstation-specific absolute paths', () => {
    for (const path of requiredDocs) {
      expect(read(path), path).not.toMatch(/\/Users\/|[A-Z]:\\\\Users\\\\/);
    }
  });

  it('documents ownership, guardrails, migrated skills, operations, cost, and delivery phases', () => {
    const combined = requiredDocs.map(read).join('\n');
    for (const phrase of [
      'source → observation → derived',
      'assertion weakening',
      'visual baseline',
      'migrated skills',
      'deferred skills',
      'retention',
      'cost',
      'troubleshooting',
      '2-day MVP'
    ]) {
      expect(combined.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it('keeps deterministic execution read-only and isolates publication', () => {
    const workflow = read('.github/workflows/execute.yml');
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toContain('publish-generated-changes:');
    expect(workflow).toContain('QALI_PUBLISH_GITHUB_TOKEN');
    expect(workflow).not.toMatch(/git push\s+(?:origin\s+)?main/);
  });
});
