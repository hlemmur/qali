import process from 'node:process';
import { resolve } from 'node:path';
import { validateProjectDirectory } from '../packages/knowledge/src/index.js';

const projectRoot = resolve(process.cwd(), process.argv[2] ?? 'projects/_demo');
const result = validateProjectDirectory(projectRoot);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
