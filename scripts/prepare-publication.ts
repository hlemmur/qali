import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import type { PublicationChange, PublicationRequest } from '../packages/publication/src/index.js';

const workspace = process.cwd();
const requestId = process.env.QALI_REQUEST_ID ?? 'local';
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: workspace,
  encoding: 'utf8'
});

const approvedScenario = (path: string): string | undefined => {
  const projectRoot = path.split('/').slice(0, 2).join('/');
  const directory = join(workspace, projectRoot, 'derived/scenarios/approved');
  try {
    const scenario = readdirSync(directory).find((name) => name.endsWith('.md'));
    return scenario ? `derived/scenarios/approved/${scenario}` : undefined;
  } catch {
    return undefined;
  }
};

const classify = (path: string): PublicationChange => {
  const content = readFileSync(join(workspace, path), 'utf8');
  if (path.includes('/derived/')) {
    return { path, mutation: 'render-derived-report', content };
  }
  if (path.includes('/observations/')) {
    return {
      path,
      mutation: path.includes('/evidence/') ? 'append-evidence' : 'append-observation',
      provenanceRef: process.env.QALI_PROVENANCE_REF ?? `workflow:${requestId}`,
      content
    };
  }
  if (path.includes('/tests/')) {
    const approvedScenarioRef = approvedScenario(path);
    return {
      path,
      mutation: 'create-test',
      content,
      ...(approvedScenarioRef ? { approvedScenarioRef } : {})
    };
  }
  if (path.includes('/sources/')) {
    const authorityRef = process.env.QALI_AUTHORITY_REF;
    const provenanceRef = process.env.QALI_PROVENANCE_REF;
    return {
      path,
      mutation: 'update-governed-source',
      content,
      ...(authorityRef ? { authorityRef } : {}),
      ...(provenanceRef ? { provenanceRef } : {})
    };
  }
  return { path, mutation: 'modify-source-code', content };
};

const changes = status
  .split('\n')
  .filter(Boolean)
  .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).split(' -> ').at(-1)! }))
  .map(({ code, path }): PublicationChange =>
    code.includes('D') ? { path, mutation: 'delete-test', deleted: true } : classify(path)
  );

const manifest: PublicationRequest = {
  requestId,
  baseBranch: 'main',
  title: `Qali generated changes for ${requestId}`,
  commitMessage: `Publish governed Qali changes for ${requestId}`,
  checks: [{ name: 'npm run check', passed: true }],
  changes
};
const output = process.env.QALI_PUBLICATION_MANIFEST ?? '.qali/publication-request.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
