import { mkdtempSync, readFileSync } from 'node:fs';
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
});
