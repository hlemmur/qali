import { mkdirSync, writeFileSync } from 'node:fs';
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
  if (command.intent !== 'maintain-knowledge' || step.id !== 'propose') {
    return { status: 'blocked', reason: 'unsupported deterministic knowledge step' };
  }
  let change: KnowledgeChangeProposal;
  try {
    change = parseProposal(command.parameters.knowledgeChange);
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: path.replaceAll('{projectId}', command.project.id)
  }));
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
