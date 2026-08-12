import { resolve } from 'node:path';
import { loadQualificationRegistry } from '../packages/agent-runtime/src/qualification.js';

const path = resolve(process.argv[2] ?? 'qualification/registry.json');
const registry = loadQualificationRegistry(path);
console.log(
  JSON.stringify({ valid: true, version: registry.version, records: registry.records.length })
);
