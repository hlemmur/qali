import { readFileSync } from 'node:fs';
import process from 'node:process';
import { SemanticPublicationManifestSchema } from '../packages/contracts/src/index.js';
import { ControlledPublisher } from '../packages/publication/src/index.js';
import { GitHubRestPublicationAdapter } from '../packages/publication/src/github.js';

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const manifestPath =
  argument('--manifest') ??
  process.env.QALI_PUBLICATION_MANIFEST ??
  '.qali/publication-request.json';
const token = process.env.QALI_PUBLISH_GITHUB_TOKEN;
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

if (!token || !owner || !repo) {
  throw new Error(
    'Controlled publication requires QALI_PUBLISH_GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO'
  );
}

const request = SemanticPublicationManifestSchema.parse(
  JSON.parse(readFileSync(manifestPath, 'utf8'))
);
const publisher = new ControlledPublisher(
  new GitHubRestPublicationAdapter({
    token,
    owner,
    repo,
    ...(process.env.GITHUB_API_URL ? { apiUrl: process.env.GITHUB_API_URL } : {})
  })
);
const result = await publisher.publish(request);
console.log(JSON.stringify(result, null, 2));
if (result.status === 'rejected') process.exitCode = 1;
