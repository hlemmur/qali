import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import type { StepExecutionResult } from './execution.js';

interface KnowledgeChangeProposal {
  factId: string;
  statement: string;
  proposedStatus: 'observed' | 'inferred' | 'confirmed';
  purpose: 'reference' | 'expected-behavior';
  source: {
    kind: 'human-decision' | 'authoritative-doc' | 'trace' | 'report' | 'session' | 'screenshot';
    ref: string;
    observedAt: string;
  };
  authority?: {
    actor: 'agent' | 'human';
    decisionRef?: string;
    authoritativeSourceRef?: string;
  };
}

function parseProposal(value: unknown): KnowledgeChangeProposal {
  if (!value || typeof value !== 'object') throw new Error('knowledge change is required');
  const change = value as Partial<KnowledgeChangeProposal>;
  if (
    typeof change.factId !== 'string' ||
    !/^[A-Z][A-Z0-9-]{1,63}$/.test(change.factId) ||
    typeof change.statement !== 'string' ||
    !change.statement.trim() ||
    !['observed', 'inferred', 'confirmed'].includes(change.proposedStatus ?? '') ||
    !['reference', 'expected-behavior'].includes(change.purpose ?? '') ||
    !change.source ||
    typeof change.source.ref !== 'string' ||
    typeof change.source.observedAt !== 'string'
  ) {
    throw new Error('knowledge change proposal is invalid');
  }
  return change as KnowledgeChangeProposal;
}

export async function executeKnowledgeMaintenanceStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  if (command.intent !== 'maintain-knowledge' || !['propose', 'reconcile'].includes(step.id)) {
    return { status: 'blocked', reason: 'unsupported deterministic knowledge step' };
  }
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: path.replaceAll('{projectId}', command.project.id)
  }));
  if (step.id === 'reconcile') {
    const projectRoot = join(workspace, command.project.root);
    const evidenceDirectory = join(projectRoot, 'observations/evidence/knowledge-maintenance');
    const proposalPath = join(evidenceDirectory, 'proposal.json');
    if (!existsSync(proposalPath)) {
      return { status: 'failed', error: 'knowledge reconciliation proposal is missing' };
    }
    const proposal = JSON.parse(readFileSync(proposalPath, 'utf8')) as {
      projectId: string;
      change: KnowledgeChangeProposal;
    };
    if (proposal.projectId !== command.project.id) {
      return { status: 'failed', error: 'knowledge proposal project does not match' };
    }
    const change = parseProposal(proposal.change);
    const ledgerPath = join(projectRoot, 'sources/reference/knowledge.json');
    const ledger = existsSync(ledgerPath)
      ? (JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
          version: 1;
          facts: Array<{
            id: string;
            statement: string;
            status: string;
            sources: KnowledgeChangeProposal['source'][];
          }>;
        })
      : { version: 1 as const, facts: [] };
    const existing = ledger.facts.find(({ id }) => id === change.factId);
    if (existing && existing.statement !== change.statement) {
      mkdirSync(evidenceDirectory, { recursive: true });
      const contradictionsPath = join(evidenceDirectory, 'contradictions.json');
      const contradictions = existsSync(contradictionsPath)
        ? (JSON.parse(readFileSync(contradictionsPath, 'utf8')) as { version: 1; items: unknown[] })
        : { version: 1 as const, items: [] };
      contradictions.items.push({
        factId: change.factId,
        existingStatement: existing.statement,
        proposedStatement: change.statement,
        proposedStatus: change.proposedStatus,
        source: change.source
      });
      writeFileSync(contradictionsPath, `${JSON.stringify(contradictions, null, 2)}\n`);
      const questionsPath = join(projectRoot, 'sources/questions.md');
      mkdirSync(dirname(questionsPath), { recursive: true });
      if (!existsSync(questionsPath)) writeFileSync(questionsPath, '# Questions\n');
      const question = `Resolve contradictory evidence for ${change.factId}`;
      if (!readFileSync(questionsPath, 'utf8').includes(question)) {
        appendFileSync(
          questionsPath,
          `\n### Q-KNOW-${change.factId}: ${question}\n\n- Status: open\n- Blocking: yes\n- Source: ${change.source.ref}\n`
        );
      }
      writeFileSync(
        join(evidenceDirectory, 'reconciliation.json'),
        `${JSON.stringify(
          {
            version: 1,
            factId: change.factId,
            outcome: 'contradiction-retained',
            questionOpened: true
          },
          null,
          2
        )}\n`
      );
      return { status: 'succeeded', outputs };
    }
    return { status: 'failed', error: 'knowledge reconciliation outcome is unsupported' };
  }
  let change: KnowledgeChangeProposal;
  try {
    change = parseProposal(command.parameters.knowledgeChange);
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
  const output = outputs[0];
  if (!output) return { status: 'failed', error: 'knowledge proposal output is missing' };
  const outputPath = join(workspace, output.path);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify({ version: 1, projectId: command.project.id, change }, null, 2)}\n`
  );
  return { status: 'succeeded', outputs };
}
