import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderSlackAppManifest } from './control-plane-setup.js';

const root = new URL('../../../', import.meta.url);
const requiredDocs = [
  'README.md',
  'docs/architecture.md',
  'docs/setup-cloudflare.md',
  'docs/setup-slack.md',
  'docs/setup-github.md',
  'docs/autonomy-and-security.md',
  'docs/project-template.md',
  'docs/roadmap.md',
  'docs/user-guide.md',
  'docs/developer-guide.md',
  'docs/current-status.md',
  'docs/slack-agent-ux-review.md',
  '.env.example'
];
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

describe('product documentation assets', () => {
  it('ships every required setup, architecture, security, template, and roadmap document', () => {
    expect(() => requiredDocs.map(read)).not.toThrow();
  });

  it('documents the live Sauce Demo target and keeps local gates', () => {
    const readme = read('README.md');
    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    expect(scripts.scripts.check).toBeDefined();
    expect(scripts.scripts['demo:test']).toBeDefined();
    expect(scripts.scripts['demo:loop']).toBeDefined();
    expect(readme).toContain('npm run check');
    expect(readme).toContain('https://www.saucedemo.com');
    expect(readme).toContain('sauce-demo');
    expect(readme).not.toContain('[MOCK MODE]');
    expect(readme).toMatch(/has been deployed and exercised/i);
    expect(readme).toContain('[readiness status](docs/current-status.md)');
    expect(readme).toMatch(/no preview URL/i);
    expect(read('docs/developer-guide.md')).toContain('npm run demo:loop');
    expect(read('docs/user-guide.md')).toContain('sauce-demo');
    expect(read('docs/user-guide.md')).toContain("I'll use");
    expect(read('docs/user-guide.md')).not.toMatch(/Try Qali locally in Mock Mode/);
    expect(read('docs/user-guide.md')).not.toContain('Working on it');
    expect(read('.env.example')).toContain('qali-sauce-demo');
    expect(read('.env.example')).toContain('https://www.saucedemo.com');
    expect(read('.env.example')).toContain('QALI_TEST_DATA_JSON={"username":"standard_user"}');
    expect(read('.env.example')).not.toContain('QALI_TEST_CREDENTIALS_JSON={"username"');
    expect(read('.env.example')).not.toContain('secret_sauce');
  });

  it('documents Cloudflare provision and Slack manifest workflows', () => {
    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const command of [
      'control-plane:provision',
      'control-plane:render-slack-manifest',
      'control-plane:sync-secrets',
      'control-plane:deploy',
      'control-plane:dry-run'
    ]) {
      expect(scripts.scripts[command]).toBeDefined();
      expect(read('docs/setup-cloudflare.md')).toContain(`npm run ${command}`);
    }

    const manifest = JSON.parse(read('apps/slack-worker/slack-app-manifest.json')) as ReturnType<
      typeof renderSlackAppManifest
    >;
    expect(manifest).toEqual(
      renderSlackAppManifest('https://qali-slack-control.example.workers.dev')
    );
    expect(read('docs/setup-slack.md')).toContain('slack-app-manifest.json');
    expect(read('docs/setup-slack.md')).toContain('slack-app-manifest.local.json');
    expect(read('docs/setup-slack.md')).toContain('From an app manifest');
    expect(read('docs/setup-slack.md')).toContain('control-plane:sync-secrets');
    expect(read('docs/setup-slack.md')).toContain('WORKER_BASE_URL');
    expect(read('docs/setup-slack.md')).toContain('qali-icon.png');
    expect(read('docs/setup-slack.md')).toContain('App Home');
    expect(read('docs/setup-slack.md')).not.toContain('CLOUDFLARE_WORKERS_SUBDOMAIN');
    expect(read('.env.example')).toContain('WORKER_BASE_URL');
    expect(read('.env.example')).toContain('CURSOR_MODEL=composer-2.5');
    expect(read('.env.example')).toContain('CURSOR_API_KEY');
    expect(read('README.md')).toContain('--only cursor');
    expect(read('docs/setup-github.md')).toContain('control-plane:sync-secrets -- --only cursor');
    expect(read('docs/setup-cloudflare.md')).toContain('--only actions');
    expect(read('.env.example')).not.toContain('CLOUDFLARE_WORKERS_SUBDOMAIN');
    expect(() => read('apps/slack-worker/assets/qali-icon.png')).not.toThrow();
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
    expect(read('docs/user-guide.md')).toMatch(/E2E QA teammate/i);
    expect(read('docs/user-guide.md')).not.toMatch(
      /Is Qali a replacement for Playwright or a QA engineer\?/
    );
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
    expect(workflow).toMatch(/publish-generated-changes:[\s\S]*?environment: qali-publication/);
    expect(workflow).toContain('QALI_PUBLISH_GITHUB_TOKEN');
    const publicationPreparation = workflow
      .split('- name: Prepare controlled publication bundle')[1]
      ?.split('- name: Run scheduled quality pulse')[0];
    expect(publicationPreparation).toContain('PROJECT_JSON: ${{ inputs.project_json }}');
    expect(workflow).not.toMatch(/git push\s+(?:origin\s+)?main/);
  });

  it('reports Slack status only after execution and publication reach terminal outcomes', () => {
    const workflow = read('.github/workflows/execute.yml');
    const executionJob = workflow
      .split('  validate-and-execute:')[1]
      ?.split('  publish-generated-changes:')[0];
    const notificationJob = workflow.split('  notify-slack:')[1];

    expect(executionJob).not.toContain('Post Slack run summary');
    expect(notificationJob).toContain('if: always()');
    expect(notificationJob).toContain('validate-and-execute');
    expect(notificationJob).toContain('publish-generated-changes');
    expect(notificationJob).toContain('Post final Slack run summary');
    expect(notificationJob).toContain("needs.publish-generated-changes.result == 'failure'");
    expect(notificationJob).toContain('EXECUTE_RESULT');
    expect(notificationJob).toContain('PUBLISH_RESULT');
  });

  it('skips Playwright, Cursor, repository check, and publication for query-project', () => {
    const workflow = read('.github/workflows/execute.yml');
    const playwright = workflow
      .split('- run: npx playwright install --with-deps chromium')[1]
      ?.split('- name: Install Cursor Agent CLI')[0];
    expect(playwright).toContain("inputs.intent != 'query-project'");
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && vars.CURSOR_MODEL != '' && inputs.intent != 'query-project'"
    );
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.intent != 'query-project' && needs.validate-and-execute.result == 'success'"
    );
    expect(workflow).toContain('.qali/quality-snapshot.json');
  });

  it('uploads evidence only for the active project, not every projects/* tree', () => {
    const workflow = read('.github/workflows/execute.yml');
    const upload = workflow
      .split('Upload Playwright and workflow evidence')[1]
      ?.split('publish-generated-changes:')[0];

    expect(upload).not.toMatch(/projects\/\*\//);
    expect(upload).toContain('fromJSON(inputs.project_json).id');
    expect(upload).toContain("|| 'sauce-demo'");
    expect(upload).not.toContain("|| '_demo'");
  });

  it('hosts HTML reports on R2 and links them from Slack as Open report', () => {
    const wrangler = read('apps/slack-worker/wrangler.jsonc');
    expect(wrangler).toContain('qali-reports');
    expect(wrangler).toContain('"binding": "REPORTS"');
    expect(read('scripts/post-run-summary.ts')).toContain('/github/report');
    expect(read('.github/workflows/execute.yml')).toContain('.qali/report.html');
    expect(read('docs/user-guide.md')).toContain('Open report');
    expect(read('docs/setup-cloudflare.md')).toContain('qali-reports');
    expect(read('docs/setup-slack.md')).toContain('Open report');
  });

  it('documents reverse-approval generation without a pre-approved scenario gate', () => {
    expect(read('workflows/generate-test-suite.yaml')).not.toContain('approved-scenario-present');
    expect(read('docs/user-guide.md')).toMatch(/Open spec/i);
    expect(read('docs/user-guide.md')).toMatch(/Retract/i);
    expect(read('docs/user-guide.md')).toMatch(/generation request/i);
    expect(read('docs/developer-guide.md')).toMatch(/generation source/i);
  });

  it('does not expose qualification bypass controls to the shared execute workflow', () => {
    const workflow = read('.github/workflows/execute.yml');
    const executeScript = read('scripts/execute.ts');

    expect(workflow).not.toContain('QALI_QUALIFICATION_MODE');
    expect(executeScript).not.toContain('process.env.QALI_QUALIFICATION_MODE');
  });

  it('pins workflow actions, runtime versions, and the verified Cursor installer', () => {
    const workflow = read('.github/workflows/execute.yml');

    expect(workflow).not.toMatch(/uses:\s+actions\/[\w-]+@v\d+/);
    expect(workflow).toContain('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5');
    expect(workflow).toContain('actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5');
    expect(workflow).toContain('node-version: 22.18.0');
    expect(workflow).toContain('CURSOR_AGENT_VERSION: 2026.08.11-e8db854');
    expect(workflow).toContain(
      'CURSOR_INSTALLER_SHA256: b1af27b9556c5f1c58d166742dbb33425ebd90a4bbd7e5453d66b920bf1f9f6b'
    );
    expect(workflow).toContain('sha256sum --check');
    expect(workflow).toContain('retention-days: 14');
  });
});
