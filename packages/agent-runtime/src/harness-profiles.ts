import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { MutationClassSchema } from '@qali/contracts';
import { loadRuntimeSkillAssets } from './skill-assets.js';
import type { HarnessProfile } from './harness-workspace.js';

export function harnessExecutionKind(profile: HarnessProfile): 'agent' | 'host' {
  return profile.kind === 'host' ? 'host' : 'agent';
}

const requiredPolicies = [
  'core/policies/operating-model.md',
  'core/policies/evidence-and-provenance.md',
  'core/policies/authority-and-autonomy.md'
];

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value as string[];
}

function safePaths(value: unknown, label: string): string[] {
  const result = strings(value, label);
  if (result.some((path) => isAbsolute(path) || path.split(/[\\/]/).includes('..'))) {
    throw new Error(`${label} contains an unsafe path`);
  }
  return result;
}

export function loadHarnessProfiles(path: string, skillRoot: string): HarnessProfile[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) {
    throw new Error('Invalid harness profile catalog');
  }
  const entries = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('No harness profiles');
  const reviewedSkills = new Set(loadRuntimeSkillAssets(skillRoot).map(({ id }) => id));
  const ids = new Set<string>();
  return entries.map((entry): HarnessProfile => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid harness profile');
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(item.id)) {
      throw new Error('Invalid harness profile id');
    }
    if (ids.has(item.id)) throw new Error(`Duplicate harness profile ${item.id}`);
    ids.add(item.id);
    const kind = item.kind === undefined ? 'agent' : item.kind;
    if (kind !== 'agent' && kind !== 'host') {
      throw new Error(`Harness profile ${item.id} has invalid kind`);
    }
    const skillIds = strings(item.skillIds, 'skillIds');
    if (
      new Set(skillIds).size !== skillIds.length ||
      (kind === 'agent' && skillIds.length === 0) ||
      (kind === 'host' && skillIds.length > 0)
    ) {
      throw new Error(`Harness profile ${item.id} has invalid skills`);
    }
    for (const skill of skillIds) {
      if (!reviewedSkills.has(skill)) throw new Error(`Unreviewed skill ${skill}`);
    }
    const policyPaths = safePaths(item.policyPaths, 'policyPaths');
    if (requiredPolicies.some((policy) => !policyPaths.includes(policy))) {
      throw new Error(`Harness profile ${item.id} lacks always-on policy`);
    }
    const writableOutputDirectories = safePaths(
      item.writableOutputDirectories,
      'writableOutputDirectories'
    );
    if (
      writableOutputDirectories.length === 0 ||
      writableOutputDirectories.some((directory) => !directory.startsWith('outputs/'))
    ) {
      throw new Error(`Harness profile ${item.id} has unsafe outputs`);
    }
    const tools = strings(item.tools, 'tools');
    if (tools.some((tool) => tool !== 'browser') || new Set(tools).size !== tools.length) {
      throw new Error(`Harness profile ${item.id} has excessive tools`);
    }
    const mutations = strings(item.mutations, 'mutations');
    if (mutations.some((mutation) => !MutationClassSchema.safeParse(mutation).success)) {
      throw new Error(`Invalid mutation class in harness profile ${item.id}`);
    }
    const validators = strings(item.validators, 'validators');
    if (validators.some((validator) => !/^[a-z][a-z0-9-]*$/.test(validator))) {
      throw new Error(`Invalid validator id in harness profile ${item.id}`);
    }
    return {
      id: item.id,
      kind,
      skillIds,
      policyPaths,
      templatePaths: safePaths(item.templatePaths, 'templatePaths'),
      writableOutputDirectories,
      tools: tools as Array<'browser'>,
      mutations,
      validators
    };
  });
}

export function selectHarnessProfile(
  profiles: readonly HarnessProfile[],
  baseProfileId: string,
  selection: { visualTesting: boolean; journeyChange?: boolean }
): HarnessProfile {
  const selectedId = (() => {
    if (baseProfileId === 'test-generation' && selection.visualTesting) {
      return 'visual-test-generation';
    }
    if (baseProfileId === 'knowledge-reconciliation' && selection.journeyChange) {
      return 'knowledge-reconciliation-journey';
    }
    return baseProfileId;
  })();
  const profile = profiles.find(({ id }) => id === selectedId);
  if (!profile) throw new Error(`Unknown harness profile ${selectedId}`);
  if (selectedId !== baseProfileId) {
    const base = profiles.find(({ id }) => id === baseProfileId);
    if (!base) throw new Error(`Unknown harness profile ${baseProfileId}`);
    const authorityFields = [
      'policyPaths',
      'writableOutputDirectories',
      'tools',
      'mutations'
    ] as const;
    if (
      authorityFields.some(
        (field) => JSON.stringify(profile[field]) !== JSON.stringify(base[field])
      )
    ) {
      throw new Error('conditional harness profile widens authority');
    }
  }
  return profile;
}
