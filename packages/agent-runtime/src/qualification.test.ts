import { describe, expect, it } from 'vitest';
import type { ModelQualificationRecord } from '@qali/contracts';
import {
  qualificationExecutionMode,
  loadQualificationRegistry,
  parseQualificationRegistry,
  selectQualifiedCombination
} from './qualification.js';

const identity = {
  cursorCliVersion: '1.7.2',
  modelIdentifier: 'composer-2.5',
  harnessVersion: '1',
  harnessHash: 'a'.repeat(64),
  skillHash: 'b'.repeat(64),
  ruleHash: 'c'.repeat(64),
  templateHash: 'd'.repeat(64),
  browserFacadeHash: 'e'.repeat(64),
  permissionHash: 'f'.repeat(64),
  evaluationSuiteHash: '1'.repeat(64)
} as const;

function record(overrides: Partial<ModelQualificationRecord> = {}): ModelQualificationRecord {
  return {
    version: 1,
    ...identity,
    qualificationRunUrl: 'https://github.com/hlemmur/qali/actions/runs/123',
    result: 'passed',
    qualifiedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-31T00:00:00.000Z',
    state: 'active',
    ...overrides
  };
}

describe('model qualification policy', () => {
  it('derives mock, qualification, and unattended policy modes from trusted execution inputs', () => {
    expect(qualificationExecutionMode('mock', false)).toBe('mock');
    expect(qualificationExecutionMode('staging', true)).toBe('qualification');
    expect(qualificationExecutionMode('production', false)).toBe('unattended');
  });

  it('loads the version-controlled qualification registry', () => {
    expect(loadQualificationRegistry('qualification/registry.json')).toEqual({
      version: 1,
      records: []
    });
  });

  it('rejects duplicate runtime identities in the versioned registry', () => {
    expect(() =>
      parseQualificationRegistry({
        version: 1,
        records: [
          record(),
          record({
            qualificationRunUrl: 'https://github.com/hlemmur/qali/actions/runs/456'
          })
        ]
      })
    ).toThrow(/duplicate qualification/i);
  });

  it('allows unattended execution only for an exact active qualification', () => {
    expect(
      selectQualifiedCombination({
        mode: 'unattended',
        candidates: [identity],
        records: [record()],
        now: new Date('2026-08-12T00:00:00.000Z')
      })
    ).toMatchObject({ allowed: true, candidate: identity });

    expect(
      selectQualifiedCombination({
        mode: 'unattended',
        candidates: [{ ...identity, permissionHash: '2'.repeat(64) }],
        records: [record()],
        now: new Date('2026-08-12T00:00:00.000Z')
      })
    ).toEqual({ allowed: false, reason: 'no active qualified runtime combination' });
  });

  it('allows any configured model in mock and qualification modes', () => {
    for (const mode of ['mock', 'qualification'] as const) {
      expect(
        selectQualifiedCombination({
          mode,
          candidates: [identity],
          records: [],
          now: new Date('2026-08-12T00:00:00.000Z')
        })
      ).toEqual({ allowed: true, candidate: identity });
    }
  });

  it('skips expired, revoked, and failed records and uses a qualified failover', () => {
    const failover = { ...identity, modelIdentifier: 'qualified-failover' };
    const decision = selectQualifiedCombination({
      mode: 'unattended',
      candidates: [identity, failover],
      records: [
        record({ expiresAt: '2026-08-31T00:00:00.000Z' }),
        record({ modelIdentifier: failover.modelIdentifier })
      ],
      now: new Date('2026-09-01T00:00:00.000Z')
    });

    expect(decision).toMatchObject({ allowed: false });

    expect(
      selectQualifiedCombination({
        mode: 'unattended',
        candidates: [identity, failover],
        records: [
          record({ state: 'revoked' }),
          record({ modelIdentifier: failover.modelIdentifier })
        ],
        now: new Date('2026-08-12T00:00:00.000Z')
      })
    ).toMatchObject({ allowed: true, candidate: failover });

    expect(
      selectQualifiedCombination({
        mode: 'unattended',
        candidates: [identity],
        records: [record({ result: 'failed' })],
        now: new Date('2026-08-12T00:00:00.000Z')
      })
    ).toEqual({ allowed: false, reason: 'no active qualified runtime combination' });
  });
});
