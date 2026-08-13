import { ProjectExecutionProfileSchema, ProjectRegistrySchema } from '@qali/contracts';
export { resolveTrustedCommand } from '@qali/project-config';
import registryDocument from '../../../projects/registry.json' with { type: 'json' };
import sauceDemoProfileDocument from '../../../projects/sauce-demo/execution-profile.json' with { type: 'json' };

export const DEFAULT_PROJECT_REGISTRY = ProjectRegistrySchema.parse(registryDocument);
export const DEFAULT_EXECUTION_PROFILES = [
  ProjectExecutionProfileSchema.parse(sauceDemoProfileDocument)
];
