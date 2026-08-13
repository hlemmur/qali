import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { executeKnowledgeMaintenanceStep } from './knowledge-maintenance.js';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeWorkflow
} from './execution.js';
import { loadWorkflowDirectory } from './workflows.js';

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

  it('keeps an unvalidated confirmation observed and opens an authority question', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-knowledge-unvalidated-authority-'));
    const projectRoot = join(workspace, 'projects/shop');
    mkdirSync(join(projectRoot, 'sources'), { recursive: true });
    writeFileSync(join(projectRoot, 'sources/questions.md'), '# Questions\n');
    writeFileSync(join(projectRoot, 'sources/decisions.md'), '# Decisions\n');
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
          factId: 'REQ-002',
          statement: 'Checkout requires a postal code.',
          proposedStatus: 'confirmed',
          purpose: 'expected-behavior',
          source: {
            kind: 'report',
            ref: 'observations/evidence/exploration/session.json',
            observedAt: '2026-08-13'
          },
          authority: { actor: 'human', decisionRef: 'D-MISSING' }
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
    expect(ledger.facts[0]).toMatchObject({ id: 'REQ-002', status: 'observed' });
    expect(readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8')).toContain(
      'Who can confirm REQ-002 as expected behavior?'
    );
  });

  it('confirms knowledge only when the cited human decision is recorded', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-knowledge-authorized-'));
    const projectRoot = join(workspace, 'projects/shop');
    mkdirSync(join(projectRoot, 'sources'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/decisions.md'),
      '# Decisions\n\n| ID | Decision |\n| --- | --- |\n| D-002 | Postal code is required. |\n'
    );
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
          factId: 'REQ-002',
          statement: 'Checkout requires a postal code.',
          proposedStatus: 'confirmed',
          purpose: 'expected-behavior',
          source: {
            kind: 'human-decision',
            ref: 'D-002',
            observedAt: '2026-08-13'
          },
          authority: { actor: 'human', decisionRef: 'D-002' }
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
    expect(ledger.facts[0]).toMatchObject({ id: 'REQ-002', status: 'confirmed' });
    const reconciliation = JSON.parse(
      readFileSync(
        join(projectRoot, 'observations/evidence/knowledge-maintenance/reconciliation.json'),
        'utf8'
      )
    );
    expect(reconciliation).toMatchObject({
      outcome: 'recorded',
      effectiveStatus: 'confirmed',
      authority: { decisionRef: 'D-002' }
    });
  });

  it('runs proposal and governed reconciliation through the production orchestrator', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-knowledge-e2e-'));
    const projectRoot = join(workspace, 'projects/shop');
    mkdirSync(join(projectRoot, 'sources'), { recursive: true });
    writeFileSync(join(projectRoot, 'sources/project-context.md'), '# Context\n');
    writeFileSync(join(projectRoot, 'sources/questions.md'), '# Questions\n');
    writeFileSync(join(projectRoot, 'sources/decisions.md'), '# Decisions\n');
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'knowledge-maintenance')!;
    const executionCommand = command({
      knowledgeChange: {
        factId: 'REQ-003',
        statement: 'Checkout displays a delivery estimate.',
        proposedStatus: 'observed',
        purpose: 'reference',
        source: {
          kind: 'report',
          ref: 'observations/evidence/exploration/session.json',
          observedAt: '2026-08-13'
        }
      }
    });

    const result = await executeWorkflow(executionCommand, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (workflowStep, workflowCommand) =>
          executeKnowledgeMaintenanceStep(workspace, workflowStep, workflowCommand)
      },
      events: new FakeEventStore(),
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'e'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(result.attempts.map(({ stepId }) => stepId)).toEqual(['propose', 'reconcile']);
    const ledger = JSON.parse(
      readFileSync(join(projectRoot, 'sources/reference/knowledge.json'), 'utf8')
    );
    expect(ledger.facts[0]).toMatchObject({ id: 'REQ-003', status: 'observed' });
  });
});
