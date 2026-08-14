import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AgentLogEntry {
  at: string;
  intent: string;
  status: string;
  workflowId?: string;
  requestId?: string;
}

export function appendAgentLog(path: string, entry: AgentLogEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readAgentLog(path: string): AgentLogEntry[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentLogEntry);
  } catch {
    return [];
  }
}
