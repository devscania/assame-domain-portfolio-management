type ShutdownOptions = {
  stopScheduling: () => void;
  dispatch: () => Promise<unknown> | undefined;
  stopQueue: () => Promise<unknown>;
  background: () => (Promise<unknown> | undefined)[];
  disconnect: () => Promise<unknown>;
};

/** Stop once, drain accepted work, then release database connections. A failed
 * task must not skip the remaining drains or produce a successful exit.
 */
export function createWorkerShutdown(options: ShutdownOptions) {
  let shutdown: Promise<void> | undefined;
  return () => {
    if (shutdown) return shutdown;
    options.stopScheduling();
    shutdown = (async () => {
      const results = await Promise.allSettled([options.dispatch()]);
      // Dispatch can still enqueue an accepted job; let it finish before the
      // queue stops accepting sends and waits for its current handlers.
      results.push(...(await Promise.allSettled([options.stopQueue()])));
      results.push(...(await Promise.allSettled(options.background())));
      results.push(...(await Promise.allSettled([options.disconnect()])));
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Worker shutdown did not complete cleanly');
    })();
    return shutdown;
  };
}
