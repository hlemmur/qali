import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendAgentLog, readAgentLog } from './agent-log.js';

describe('agent log', () => {
  it('appends concise JSONL entries that query and pulse can cite', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'qali-agent-log-')), 'agent-log.jsonl');
    appendAgentLog(path, {
      at: '2026-08-14T12:00:00.000Z',
      intent: 'quality-pulse',
      status: 'succeeded',
      workflowId: 'quality-pulse',
      requestId: 'scheduled-1'
    });
    appendAgentLog(path, {
      at: '2026-08-14T12:01:00.000Z',
      intent: 'maintain-schedule',
      status: 'succeeded'
    });
    expect(readAgentLog(path)).toEqual([
      {
        at: '2026-08-14T12:00:00.000Z',
        intent: 'quality-pulse',
        status: 'succeeded',
        workflowId: 'quality-pulse',
        requestId: 'scheduled-1'
      },
      { at: '2026-08-14T12:01:00.000Z', intent: 'maintain-schedule', status: 'succeeded' }
    ]);
  });
});
