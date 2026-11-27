// Loaded only by the isolated Playwright app process, never normal web/worker startup.
const originalFetch = globalThis.fetch;
globalThis.fetch = function guardedFetch(input, init) {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
    return Promise.reject(new Error('Browser fixtures block external server fetches'));
  return originalFetch(input, init);
};
