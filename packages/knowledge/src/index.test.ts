import { describe, expect, it } from 'vitest';
import {
  assessPromotion,
  classifyMutation,
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
