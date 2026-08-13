import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { assessPromotion, type KnowledgeFact } from '../../knowledge/src/index.js';
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

const EVIDENCE_SOURCE_KINDS: ReadonlyArray<KnowledgeChangeProposal['source']['kind']> = [
  'human-decision',
  'authoritative-doc',
  'trace',
  'report',
  'session',
  'screenshot'
];

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
    !EVIDENCE_SOURCE_KINDS.includes(change.source.kind) ||
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
    const questionsPath = join(projectRoot, 'sources/questions.md');
    mkdirSync(dirname(questionsPath), { recursive: true });
    if (!existsSync(questionsPath)) writeFileSync(questionsPath, '# Questions\n');
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
    const decisionsPath = join(projectRoot, 'sources/decisions.md');
    const decisions = existsSync(decisionsPath) ? readFileSync(decisionsPath, 'utf8') : '';
    const decisionRef = change.authority?.decisionRef?.trim();
    const decisionIsRecorded = Boolean(
      change.authority?.actor === 'human' &&
      decisionRef &&
      new RegExp(
        `(?:^|[|#\\s])${decisionRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[|:\\s]|$)`,
        'm'
      ).test(decisions)
    );
    const sourceRef = change.authority?.authoritativeSourceRef?.trim();
    const referenceRoot = resolve(projectRoot, 'sources/reference');
    const authoritativePath = sourceRef ? resolve(projectRoot, sourceRef) : '';
    const sourceIsRecorded = Boolean(
      sourceRef &&
      authoritativePath.startsWith(`${referenceRoot}${sep}`) &&
      existsSync(authoritativePath)
    );
    const fact: KnowledgeFact = {
      id: change.factId,
      statement: change.statement,
      status: 'observed',
      sources: [change.source]
    };
    const promotion = assessPromotion({
      fact,
      targetStatus: change.proposedStatus,
      purpose: change.purpose,
      authority: {
        actor: decisionIsRecorded ? 'human' : 'agent',
        ...(decisionIsRecorded && decisionRef ? { decisionRef } : {}),
        ...(decisionIsRecorded && sourceIsRecorded && sourceRef
          ? { authoritativeSourceRef: sourceRef }
          : {})
      }
    });
    const authorizedStatus =
      change.proposedStatus === 'confirmed' && !promotion.allowed
        ? 'observed'
        : change.proposedStatus;
    const effectiveStatus = existing?.status === 'confirmed' ? 'confirmed' : authorizedStatus;
    if (existing) {
      existing.status = effectiveStatus;
      if (!existing.sources.some(({ ref }) => ref === change.source.ref)) {
        existing.sources.push(change.source);
      }
    } else {
      ledger.facts.push({
        id: change.factId,
        statement: change.statement,
        status: effectiveStatus,
        sources: [change.source]
      });
    }
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    const awaitingAuthority =
      change.proposedStatus === 'confirmed' &&
      !promotion.allowed &&
      existing?.status !== 'confirmed';
    if (awaitingAuthority) {
      const question = `Who can confirm ${change.factId} as expected behavior?`;
      if (!readFileSync(questionsPath, 'utf8').includes(question)) {
        appendFileSync(
          questionsPath,
          `\n### Q-AUTH-${change.factId}: ${question}\n\n- Status: open\n- Blocking: yes\n- Source: ${change.source.ref}\n`
        );
      }
    }
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      join(evidenceDirectory, 'reconciliation.json'),
      `${JSON.stringify(
        {
          version: 1,
          factId: change.factId,
          outcome: awaitingAuthority ? 'awaiting-authority' : 'recorded',
          requestedStatus: change.proposedStatus,
          effectiveStatus,
          authority: {
            decisionRef: decisionIsRecorded ? decisionRef : null,
            authoritativeSourceRef: sourceIsRecorded ? sourceRef : null
          }
        },
        null,
        2
      )}\n`
    );
    return { status: 'succeeded', outputs };
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
