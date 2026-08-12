import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  ProjectExecutionProfileSchema,
  ProjectRegistrySchema
} from '../packages/contracts/src/index.js';

const workspace = process.cwd();
const registryPath = join(workspace, 'projects/registry.json');
const registry = ProjectRegistrySchema.parse(JSON.parse(readFileSync(registryPath, 'utf8')));

for (const project of registry.projects) {
  const root = join(workspace, project.root);
  if (!existsSync(root)) throw new Error(`Registered project root does not exist: ${project.root}`);
  const profilePath = join(root, 'execution-profile.json');
  if (!existsSync(profilePath)) {
    throw new Error(`Missing execution profile for ${project.id}: ${profilePath}`);
  }
  const profile = ProjectExecutionProfileSchema.parse(
    JSON.parse(readFileSync(profilePath, 'utf8'))
  );
  if (profile.id !== project.activeExecutionProfile) {
    throw new Error(
      `Active profile mismatch for ${project.id}: registry=${project.activeExecutionProfile}, file=${profile.id}`
    );
  }
  if (profile.projectId !== project.id) {
    throw new Error(`Execution profile ${profile.id} does not belong to ${project.id}`);
  }
  if (profile.publication.reviewOnly !== project.publication.reviewOnly) {
    throw new Error(`Publication policy mismatch for ${project.id}`);
  }
}

console.log(
  JSON.stringify({
    valid: true,
    registryVersion: registry.version,
    projects: registry.projects.length
  })
);
