import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessPromotion,
  classifyMutation,
  refreshGeneratedMarkers,
  renderGeneratedJson,
  scaffoldProject,
  validateProjectDirectory,
  validateProjectKnowledge,
  type KnowledgeFact
} from './index.js';

describe('knowledge governance', () => {
  it('refuses to turn an observation into expected behavior without human authority', () => {
    const fact: KnowledgeFact = {
      id: 'F-001',
      statement: 'Save shows a success toast',
      status: 'observed',
      sources: [{ kind: 'session', ref: 'evidence/sessions/001.md', observedAt: '2026-08-10' }]
    };

    expect(
      assessPromotion({
        fact,
        targetStatus: 'confirmed',
        purpose: 'expected-behavior',
        authority: { actor: 'agent' }
      })
    ).toEqual({
      allowed: false,
      reason: 'expected behavior requires a recorded human decision or authoritative source'
    });
  });

  it('allows confirmed expected behavior when a human decision is recorded', () => {
    const fact: KnowledgeFact = {
      id: 'F-001',
      statement: 'Save shows a success toast',
      status: 'observed',
      sources: [{ kind: 'trace', ref: 'evidence/traces/save.zip', observedAt: '2026-08-10' }]
    };

    expect(
      assessPromotion({
        fact,
        targetStatus: 'confirmed',
        purpose: 'expected-behavior',
        authority: { actor: 'human', decisionRef: 'D-004' }
      })
    ).toEqual({ allowed: true });
  });

  it('classifies only low-risk, evidence-preserving changes as auto-mergeable', () => {
    expect(classifyMutation('append-observation')).toBe('auto-merge');
    expect(classifyMutation('update-visual-baseline')).toBe('human-approval');
    expect(classifyMutation('weaken-assertion')).toBe('prohibited');
  });
});

describe('project knowledge validation', () => {
  const complete = [
    '# QA Project Context',
    '## Product',
    'Real product',
    '## Tech Stack',
    'TypeScript',
    '## Test Stack',
    'Vitest',
    '## CI/CD',
    'GitHub Actions',
    '## Environments',
    'Local',
    '## Quality Goals',
    'Fast feedback',
    '## Risk Areas',
    'Authentication',
    '## Team',
    'One QA lead',
    '## Conventions',
    'Behavior-focused tests'
  ].join('\n');

  it('reports missing sections and unresolved placeholders', () => {
    const result = validateProjectKnowledge(
      complete.replace('## Team\nOne QA lead', '').replace('Real product', '[product]')
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-section', section: 'Team' }),
        expect.objectContaining({ code: 'placeholder' })
      ])
    );
  });

  it('accepts a complete context', () => {
    expect(validateProjectKnowledge(complete)).toEqual({ valid: true, issues: [] });
  });
});

describe('canonical project template', () => {
  it('contains every workflow-owned physical area and governed knowledge artifact', () => {
    const required = [
      'execution-profile.json',
      'sources/project-context.md',
      'sources/reference/requirements.md',
      'sources/reference/journeys.md',
      'sources/reference/risks.md',
      'sources/questions.md',
      'sources/decisions.md',
      'sources/reference/test-data.md',
      'sources/autonomy-policy.md',
      'observations/exploration.md',
      'observations/known-issues.md',
      'observations/evidence/index.md',
      'derived/strategy.md',
      'derived/plan.md',
      'derived/scenarios/.generated.md',
      'derived/coverage/.generated.md',
      'derived/reports/.generated.md',
      'derived/tasks/.generated.md',
      'derived/jobs/.generated.md',
      'derived/workflow-state/.generated.md',
      'tests/README.md'
    ];

    expect(required.filter((path) => !existsSync(`projects/_template/${path}`))).toEqual([]);
  });

  it('scaffolds an isolated project and renders its identity', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      const result = scaffoldProject('merchant-portal', {
        projectsRoot,
        templateRoot,
        date: '2026-08-10'
      });
      const contextPath = join(result.projectRoot, 'sources/project-context.md');

      expect(readFileSync(contextPath, 'utf8')).toContain('merchant-portal');
      expect(readFileSync(contextPath, 'utf8')).not.toContain('{{PROJECT_ID}}');

      writeFileSync(contextPath, '# changed copy\n');
      expect(readFileSync(new URL('sources/project-context.md', templateRoot), 'utf8')).toContain(
        '{{PROJECT_ID}}'
      );
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsafe project IDs and refuses to overwrite an existing project', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      for (const projectId of [
        '../escape',
        '/absolute',
        'MixedCase',
        '_reserved',
        'two words',
        'two--words',
        'a'.repeat(65)
      ]) {
        expect(() => scaffoldProject(projectId, { projectsRoot, templateRoot })).toThrow(
          /project id/i
        );
      }

      scaffoldProject('safe-project', { projectsRoot, templateRoot, date: '2026-08-10' });
      expect(() => scaffoldProject('safe-project', { projectsRoot, templateRoot })).toThrow(
        /already exists/i
      );
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('validates a freshly scaffolded project as complete', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      const { projectRoot } = scaffoldProject('complete-project', {
        projectsRoot,
        templateRoot,
        date: '2026-08-10'
      });

      expect(validateProjectDirectory(projectRoot)).toEqual({ valid: true, issues: [] });
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('scaffolds a staging-shaped profile without Mock Mode or a local web server', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      const { projectRoot } = scaffoldProject('merchant-portal', {
        projectsRoot,
        templateRoot,
        date: '2026-08-13'
      });
      const profile = JSON.parse(
        readFileSync(join(projectRoot, 'execution-profile.json'), 'utf8')
      ) as {
        id: string;
        environmentLabel: string;
        displayBadge?: string;
        webServer?: unknown;
      };

      expect(profile).toMatchObject({
        id: 'merchant-portal-staging',
        environmentLabel: 'staging'
      });
      expect(profile.displayBadge).toBeUndefined();
      expect(profile.webServer).toBeUndefined();
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('rejects execution profiles that do not belong to the project', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      const { projectRoot } = scaffoldProject('profile-project', {
        projectsRoot,
        templateRoot,
        date: '2026-08-10'
      });
      const path = join(projectRoot, 'execution-profile.json');
      const profile = JSON.parse(readFileSync(path, 'utf8')) as { projectId: string };
      profile.projectId = 'other-project';
      writeFileSync(path, JSON.stringify(profile));

      expect(validateProjectDirectory(projectRoot).issues).toContainEqual(
        expect.objectContaining({
          code: 'invalid-execution-profile',
          path: 'execution-profile.json'
        })
      );
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('detects direct edits to Qali-owned derived files', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      const { projectRoot } = scaffoldProject('tampered-project', {
        projectsRoot,
        templateRoot,
        date: '2026-08-10'
      });
      const planPath = join(projectRoot, 'derived/plan.md');
      writeFileSync(planPath, `${readFileSync(planPath, 'utf8')}\nManual change.\n`);

      expect(validateProjectDirectory(projectRoot)).toEqual({
        valid: false,
        issues: [
          expect.objectContaining({
            code: 'modified-generated-file',
            path: 'derived/plan.md'
          })
        ]
      });

      expect(refreshGeneratedMarkers(projectRoot)).toBeGreaterThan(0);
      expect(validateProjectDirectory(projectRoot)).toEqual({ valid: true, issues: [] });

      writeFileSync(join(projectRoot, 'derived/reports/manual.md'), '# Manual report\n');
      expect(validateProjectDirectory(projectRoot).issues).toContainEqual(
        expect.objectContaining({
          code: 'invalid-generated-marker',
          path: 'derived/reports/manual.md'
        })
      );
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('validates generated JSON markers and semantic hashes', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      const { projectRoot } = scaffoldProject('json-project', {
        projectsRoot,
        templateRoot,
        date: '2026-08-10'
      });
      const reportPath = join(projectRoot, 'derived/reports/run.json');
      writeFileSync(reportPath, renderGeneratedJson({ status: 'passed', total: 2 }));
      expect(validateProjectDirectory(projectRoot)).toEqual({ valid: true, issues: [] });

      const edited = JSON.parse(readFileSync(reportPath, 'utf8')) as { total: number };
      edited.total = 99;
      writeFileSync(reportPath, JSON.stringify(edited, null, 2));
      expect(validateProjectDirectory(projectRoot).issues).toContainEqual(
        expect.objectContaining({
          code: 'modified-generated-file',
          path: 'derived/reports/run.json'
        })
      );
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });

  it('keeps governed sources human-editable and generated ownership confined to derived files', () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), 'qali-projects-'));
    const templateRoot = new URL('../../../projects/_template/', import.meta.url);

    try {
      const { projectRoot } = scaffoldProject('ownership-project', {
        projectsRoot,
        templateRoot,
        date: '2026-08-10'
      });
      const contextPath = join(projectRoot, 'sources/project-context.md');
      writeFileSync(
        contextPath,
        `<!-- qali:generated owner=qali sha256=${'0'.repeat(64)} -->\n${readFileSync(contextPath, 'utf8')}`
      );

      expect(validateProjectDirectory(projectRoot).issues).toContainEqual(
        expect.objectContaining({
          code: 'generated-marker-in-source',
          path: 'sources/project-context.md'
        })
      );
    } finally {
      rmSync(projectsRoot, { recursive: true, force: true });
    }
  });
});

describe('sauce-demo live project', () => {
  it('is a non-mock pack for the public Sauce Demo store', () => {
    const sauceRoot = new URL('../../../projects/sauce-demo/', import.meta.url);
    const profile = JSON.parse(
      readFileSync(new URL('execution-profile.json', sauceRoot), 'utf8')
    ) as {
      environmentLabel: string;
      displayBadge?: string;
      webServer?: unknown;
      browser: { allowedSubmissions?: Array<{ role: string; name: string }> };
    };
    const pack = [
      'sources/project-context.md',
      'sources/reference/journeys.md',
      'sources/reference/test-data.md',
      'sources/decisions.md'
    ]
      .map((path) => readFileSync(new URL(path, sauceRoot), 'utf8'))
      .join('\n');

    expect(validateProjectDirectory(sauceRoot)).toEqual({ valid: true, issues: [] });
    expect(profile.environmentLabel).toBe('production');
    expect(profile.displayBadge).toBeUndefined();
    expect(profile.webServer).toBeUndefined();
    expect(profile.browser.allowedSubmissions).toEqual([{ role: 'button', name: 'Login' }]);
    expect(pack).toContain('https://www.saucedemo.com');
    expect(pack).toContain('standard_user');
    expect(pack.toLowerCase()).not.toContain('secret_sauce');
    expect(existsSync(new URL('tests/sauce-demo.spec.ts', sauceRoot))).toBe(false);
  });
});

describe('mock-mode demo project', () => {
  it('is a valid self-contained target with observable login and dashboard behavior', () => {
    const demoRoot = new URL('../../../projects/_demo/', import.meta.url);
    const context = readFileSync(new URL('sources/project-context.md', demoRoot), 'utf8');
    const app = readFileSync(new URL('app/public/index.html', demoRoot), 'utf8');

    expect(validateProjectDirectory(demoRoot)).toEqual({ valid: true, issues: [] });
    expect(context).not.toMatch(/\{\{[^}]+\}\}/);
    expect(app).toContain('MOCK MODE');
    expect(app).toMatch(/<form[^>]+id="login-form"/);
    expect(app).toMatch(/id="dashboard"/);
    expect(existsSync(new URL('app/server.mjs', demoRoot))).toBe(true);
  });

  it('serves the mock experience and exposes its mode through health', async () => {
    const moduleUrl = new URL('../../../projects/_demo/app/server.mjs', import.meta.url).href;
    const { createDemoServer } = (await import(moduleUrl)) as {
      createDemoServer: () => Server;
    };
    const server = createDemoServer();

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;

      await expect(fetch(`${origin}/health`).then((response) => response.json())).resolves.toEqual({
        ok: true,
        mode: 'mock'
      });
      await expect(fetch(origin).then((response) => response.text())).resolves.toContain(
        'MOCK MODE'
      );
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
