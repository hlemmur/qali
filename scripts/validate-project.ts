import process from 'node:process';
import { resolve } from 'node:path';
import {
  refreshGeneratedMarkers,
  validateProjectDirectory
} from '../packages/knowledge/src/index.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--refresh');
const refresh = process.argv.includes('--refresh');
const projectRoot = resolve(process.cwd(), args[0] ?? 'projects/_demo');
if (refresh) {
  const updated = refreshGeneratedMarkers(projectRoot);
  console.log(JSON.stringify({ refreshed: updated }, null, 2));
}
const result = validateProjectDirectory(projectRoot);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
