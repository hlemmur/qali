import { describe, expect, it, vi } from 'vitest';
import { boundFetch } from './fetch.js';

describe('boundFetch', () => {
  it('invokes global fetch through a wrapper so Workers keep the correct this', async () => {
    const original = globalThis.fetch;
    const spy = vi.fn(async () => new Response('ok'));
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      await boundFetch('https://example.test/qali');
      expect(spy).toHaveBeenCalledWith('https://example.test/qali', undefined);
    } finally {
      globalThis.fetch = original;
    }
  });
});
