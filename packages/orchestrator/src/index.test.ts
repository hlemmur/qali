import { describe, expect, it } from 'vitest';
import {
  BINDING_CATALOG,
  aggregateOpenItems,
  decideAutonomy,
  isExecutionBlocked
} from './index.js';

describe('human decision inbox', () => {
  it('aggregates open questions, pending issue reviews, and explicit review markers', () => {
    const result = aggregateOpenItems({
      questions: `### Q-002: Which account should automation use?
- Status: open
- Blocking: yes

### Q-003: Already resolved
- Status: answered
- Blocking: yes`,
      knownIssues: `### KI-004: Export intermittently stalls
- Human review: pending`,
      reviewMarkers: `- [ ] REVIEW: Confirm smoke scope`,
      decisions: '- **Allow proceed with open questions:** no'
    });

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'Q-002', kind: 'question', blocking: true }),
      expect.objectContaining({ id: 'KI-004', kind: 'known-issue-review', blocking: false }),
      expect.objectContaining({ id: 'REVIEW-1', kind: 'review-marker', blocking: false })
    ]);
    expect(isExecutionBlocked(result)).toBe(true);
  });

  it('honors only an explicit recorded override for the execution gate', () => {
    const result = aggregateOpenItems({
      questions: `### Q-001: Missing account
- Status: open
- Blocking: yes`,
      decisions: '- **Allow proceed with open questions:** yes'
    });

    expect(result.overrideAllowed).toBe(true);
    expect(isExecutionBlocked(result)).toBe(false);
  });
});

describe('autonomy boundary', () => {
  it('permits discovery observations but holds execution behind blockers', () => {
    const blockedInbox = aggregateOpenItems({
      questions: `### Q-001: Missing account
- Status: open
- Blocking: yes`
    });

    expect(
      decideAutonomy({
        mutation: 'append-observation',
        workClass: 'discovery',
        inbox: blockedInbox
      })
    ).toEqual({ allowed: true, mergeClass: 'auto-merge' });

    expect(
      decideAutonomy({
        mutation: 'render-derived-report',
        workClass: 'execution',
        inbox: blockedInbox
      })
    ).toEqual({
      allowed: false,
      mergeClass: 'auto-merge',
      reason: 'execution is blocked by unresolved human decisions'
    });
  });

  it('requires approval for authority-changing mutations', () => {
    expect(
      decideAutonomy({
        mutation: 'update-visual-baseline',
        workClass: 'execution',
        inbox: { items: [], overrideAllowed: false }
      })
    ).toEqual({
      allowed: false,
      mergeClass: 'human-approval',
      reason: 'mutation requires explicit human approval'
    });
  });
});

describe('internal binding catalog', () => {
  it('contains all five harness concepts with local policy bindings', () => {
    expect(BINDING_CATALOG.map((binding) => binding.id)).toEqual([
      'project-discovery',
      'knowledge-curator',
      'smoke-test-design',
      'scope-proposal',
      'task-tracker'
    ]);
    expect(
      BINDING_CATALOG.every((binding) => binding.policies.every((path) => !path.startsWith('/')))
    ).toBe(true);
  });
});
