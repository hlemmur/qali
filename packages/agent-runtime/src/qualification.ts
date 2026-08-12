import {
  ModelQualificationRecordSchema,
  ModelQualificationRegistrySchema,
  type ModelQualificationRecord,
  type ModelQualificationRegistry
} from '@qali/contracts';
import { readFileSync } from 'node:fs';

const IDENTITY_FIELDS = [
  'cursorCliVersion',
  'modelIdentifier',
  'harnessVersion',
  'harnessHash',
  'skillHash',
  'ruleHash',
  'templateHash',
  'browserFacadeHash',
  'permissionHash',
  'evaluationSuiteHash'
] as const;

export type RuntimeQualificationIdentity = Pick<
  ModelQualificationRecord,
  (typeof IDENTITY_FIELDS)[number]
>;

export type QualificationExecutionMode = 'mock' | 'qualification' | 'unattended';

export type QualificationDecision =
  | {
      allowed: true;
      candidate: RuntimeQualificationIdentity;
      qualification?: ModelQualificationRecord;
    }
  | { allowed: false; reason: string };

function sameIdentity(
  record: ModelQualificationRecord,
  candidate: RuntimeQualificationIdentity
): boolean {
  return IDENTITY_FIELDS.every((field) => record[field] === candidate[field]);
}

export function qualificationIdentityKey(identity: RuntimeQualificationIdentity): string {
  return JSON.stringify(IDENTITY_FIELDS.map((field) => identity[field]));
}

export function parseQualificationRegistry(input: unknown): ModelQualificationRegistry {
  const registry = ModelQualificationRegistrySchema.parse(input);
  const keys = new Set<string>();
  for (const record of registry.records) {
    const key = qualificationIdentityKey(record);
    if (keys.has(key)) throw new Error('duplicate qualification runtime identity');
    keys.add(key);
  }
  return registry;
}

export function loadQualificationRegistry(path: string): ModelQualificationRegistry {
  return parseQualificationRegistry(JSON.parse(readFileSync(path, 'utf8')));
}

export function selectQualifiedCombination(request: {
  mode: QualificationExecutionMode;
  candidates: readonly RuntimeQualificationIdentity[];
  records: readonly ModelQualificationRecord[];
  now: Date;
}): QualificationDecision {
  if (request.candidates.length === 0) {
    return { allowed: false, reason: 'no runtime combination configured' };
  }
  if (request.mode === 'mock' || request.mode === 'qualification') {
    return { allowed: true, candidate: request.candidates[0]! };
  }

  const records = request.records.map((record) => ModelQualificationRecordSchema.parse(record));
  for (const candidate of request.candidates) {
    const qualification = records.find(
      (record) =>
        sameIdentity(record, candidate) &&
        record.result === 'passed' &&
        record.state === 'active' &&
        Date.parse(record.qualifiedAt) <= request.now.getTime() &&
        request.now.getTime() < Date.parse(record.expiresAt)
    );
    if (qualification) return { allowed: true, candidate, qualification };
  }
  return { allowed: false, reason: 'no active qualified runtime combination' };
}
