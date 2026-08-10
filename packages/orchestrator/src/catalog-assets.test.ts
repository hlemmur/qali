import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MVP_SKILLS = [
  'qa-project-context',
  'qa-start',
  'qa-project-bootstrap',
  'journey-mapping',
  'risk-based-testing',
  'test-strategy',
  'test-planning',
  'exploratory-testing',
  'agentic-browser-testing',
  'playwright-automation',
  'ai-test-generation',
  'visual-testing',
  'test-data-management',
  'bug-reproduction',
  'ai-bug-triage',
  'test-reliability',
  'selector-drift-recovery',
  'qa-report-humanizer'
] as const;

describe('standalone skill assets', () => {
  it('ships every MVP skill with provenance and actionable internal instructions', () => {
    const catalog = JSON.parse(readFileSync('skills/catalog.json', 'utf8')) as {
      skills: Array<{
        id: string;
        provenance: { source: string; path: string; hash: string };
        instructions: { workflow: string[]; guardrails: string[] };
      }>;
    };
    const lock = JSON.parse(readFileSync('skills/skills-lock.json', 'utf8')) as {
      skills: Record<string, { computedHash: string }>;
    };

    expect(catalog.skills.map(({ id }) => id)).toEqual(MVP_SKILLS);
    for (const skill of catalog.skills) {
      expect(skill.instructions.workflow.length).toBeGreaterThan(0);
      expect(skill.instructions.guardrails.length).toBeGreaterThan(0);
      expect(skill.provenance.hash).toBe(lock.skills[skill.id]?.computedHash);
    }
  });

  it('contains no machine-local absolute runtime paths', () => {
    const assets = [
      readFileSync('skills/catalog.json', 'utf8'),
      readFileSync('skills/skills-lock.json', 'utf8')
    ].join('\n');

    expect(assets).not.toMatch(/\/Users\//);
  });
});

describe('runtime policy assets', () => {
  it('ships the canonical policies and normalized artifact templates', () => {
    const required = [
      'core/policies/operating-model.md',
      'core/policies/evidence-and-provenance.md',
      'core/policies/authority-and-autonomy.md',
      'core/policies/project-knowledge.md',
      'core/policies/test-authoring.md',
      'core/templates/project-context.md',
      'core/templates/questions.md',
      'core/templates/decisions.md',
      'core/templates/known-issues.md',
      'core/templates/scenario-spec.md',
      'core/templates/smoke-proposal.md',
      'core/templates/session-log.md',
      'core/templates/bug-report.md',
      'core/templates/task.md',
      'core/templates/job.md',
      'core/templates/scope-proposal.md'
    ];

    expect(required.filter((path) => !existsSync(path))).toEqual([]);
  });

  it('makes Qali the default source author without treating observations as authority', () => {
    const operatingModel = readFileSync('core/policies/operating-model.md', 'utf8');
    const authorityPolicy = readFileSync('core/policies/authority-and-autonomy.md', 'utf8');

    expect(`${operatingModel}\n${authorityPolicy}`).toMatch(
      /Qali (?:is a governed QA harness that )?authors and maintains .*sources by default/i
    );
    expect(`${operatingModel}\n${authorityPolicy}`).toMatch(
      /observation alone (?:never|cannot) (?:defines?|redefine)/i
    );
    expect(operatingModel).not.toMatch(/a human owns expected behavior/i);
  });
});
