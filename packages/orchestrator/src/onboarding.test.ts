import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { executeOnboardingMockStep, loadWorkflowDirectory } from './index.js';

const command: NormalizedCommand = {
  intent: 'onboard-project',
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: {}
};

describe('deterministic project onboarding', () => {
  it('builds governed context from evidence and leaves missing facts unknown', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboarding-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/onboarding-evidence.json'),
      JSON.stringify({
        version: 1,
        projectName: 'Sample Portal',
        observedAt: '2026-08-13',
        facts: [
          {
            id: 'FACT-001',
            category: 'product',
            statement: 'Sample Portal lets customers review open support requests.',
            source: 'README.md'
          },
          {
            id: 'FACT-002',
            category: 'quality-goal',
            statement: 'Customers must always see the current request status.',
            source: 'requirements.md#status'
          }
        ],
        journeys: [],
        risks: []
      })
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'project-onboarding')!;

    const result = await executeOnboardingMockStep(
      workspace,
      workflow.steps[0]!,
      command
    );

    expect(result.status).toBe('succeeded');
    const context = readFileSync(join(projectRoot, 'sources/project-context.md'), 'utf8');
    const questions = readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8');
    expect(context).toContain('Sample Portal lets customers review open support requests.');
    expect(context).toContain('Source: `README.md`');
    expect(context).toContain('## Tech Stack\n\nUnknown');
    expect(context).not.toMatch(/Node|React|Playwright/);
    expect(questions).toContain('What is the project tech stack?');
    expect(questions).toContain('| open |');
  });
});
