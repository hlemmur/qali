import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { withProjectWebServer, type WebServerChild } from './project-web-server.js';

describe('withProjectWebServer', () => {
  it('waits for project health before running browser work and always stops the server', async () => {
    const child = new EventEmitter() as WebServerChild;
    child.kill = vi.fn(() => true);
    const events: string[] = [];
    const health = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await expect(
      withProjectWebServer(
        {
          command: 'node projects/_demo/app/server.mjs',
          url: 'http://127.0.0.1:4173/health'
        },
        async () => {
          events.push('task');
          return 'completed';
        },
        {
          spawn: () => {
            events.push('spawn');
            return child;
          },
          fetch: health,
          wait: async () => undefined,
          timeoutMs: 1_000
        }
      )
    ).resolves.toBe('completed');

    expect(events).toEqual(['spawn', 'task']);
    expect(health).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
