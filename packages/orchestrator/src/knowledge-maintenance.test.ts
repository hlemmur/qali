import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { executeKnowledgeMaintenanceStep } from './knowledge-maintenance.js';

const command = (parameters: Record<string, unknown>): NormalizedCommand => ({
  intent: 'maintain-knowledge',
  project: { id: 'shop', root: 'projects/shop', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters
});

const step = (id: string, outputs: WorkflowStep['outputs']): WorkflowStep =>
  ({ id, outputs }) as WorkflowStep;

describe('knowledge maintenance', () => {
  it('materializes a typed Mock Mode reconciliation proposal', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-knowledge-proposal-'));
    const result = await executeKnowledgeMaintenanceStep(
      workspace,
      step('propose', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/knowledge-maintenance/proposal.json'
        }
      ]),
      command({
        knowledgeChange: {
          factId: 'REQ-001',
          statement: 'Checkout requires a postal code.',
          proposedStatus: 'observed',
          purpose: 'reference',
          source: {
            kind: 'report',
            ref: 'observations/evidence/exploration/session.json',
            observedAt: '2026-08-13'
          }
        }
      })
    );

    expect(result.status).toBe('succeeded');
    expect(
      JSON.parse(
        readFileSync(
          join(
            workspace,
            'projects/shop/observations/evidence/knowledge-maintenance/proposal.json'
          ),
          'utf8'
        )
      )
    ).toMatchObject({
      version: 1,
      projectId: 'shop',
      change: {
        factId: 'REQ-001',
        proposedStatus: 'observed',
        statement: 'Checkout requires a postal code.'
      }
    });
  });

  it('retains contradictory knowledge and opens a sourced question', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-knowledge-contradiction-'));
    const projectRoot = join(workspace, 'projects/shop');
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/knowledge.json'),
      `${JSON.stringify({
        version: 1,
        facts: [
          {
            id: 'REQ-001',
            statement: 'Checkout does not require a postal code.',
            status: 'confirmed',
            sources: [
              {
                kind: 'human-decision',
                ref: 'D-001',
                observedAt: '2026-08-10'
              }
            ]
          }
        ]
      })}\n`
    );
    mkdirSync(join(projectRoot, 'sources'), { recursive: true });
    writeFileSync(join(projectRoot, 'sources/questions.md'), '# Questions\n');
    await executeKnowledgeMaintenanceStep(
      workspace,
      step('propose', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/knowledge-maintenance/proposal.json'
        }
      ]),
      command({
        knowledgeChange: {
          factId: 'REQ-001',
          statement: 'Checkout requires a postal code.',
          proposedStatus: 'observed',
          purpose: 'reference',
          source: {
            kind: 'report',
            ref: 'observations/evidence/exploration/session.json',
            observedAt: '2026-08-13'
          }
        }
      })
    );

    const result = await executeKnowledgeMaintenanceStep(
      workspace,
      step('reconcile', [
        { artifact: 'reference', path: 'projects/{projectId}/sources/reference' },
        { artifact: 'questions', path: 'projects/{projectId}/sources/questions.md' },
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/knowledge-maintenance'
        }
      ]),
      command({})
    );

    expect(result.status).toBe('succeeded');
    const ledger = JSON.parse(
      readFileSync(join(projectRoot, 'sources/reference/knowledge.json'), 'utf8')
    );
    expect(ledger.facts).toHaveLength(1);
    expect(ledger.facts[0].statement).toBe('Checkout does not require a postal code.');
    const contradictions = JSON.parse(
      readFileSync(
        join(projectRoot, 'observations/evidence/knowledge-maintenance/contradictions.json'),
        'utf8'
      )
    );
    expect(contradictions.items[0]).toMatchObject({
      factId: 'REQ-001',
      existingStatement: 'Checkout does not require a postal code.',
      proposedStatement: 'Checkout requires a postal code.'
    });
    expect(readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8')).toContain(
      'Resolve contradictory evidence for REQ-001'
    );
  });
});
