/** Cloudflare Workers rejects unbound `fetch` calls (Illegal invocation). */
export const boundFetch: typeof fetch = (input, init) => fetch(input, init);
