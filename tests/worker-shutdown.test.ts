import { describe, expect, it, vi } from 'vitest';
import { createWorkerShutdown } from '../src/lib/worker-shutdown';

function pending() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('worker shutdown', () => {
  it('stops scheduling once and drains accepted dispatch and notifications before disconnecting', async () => {
    const dispatch = pending(),
      notifications = pending();
    const stopScheduling = vi.fn(),
      stopQueue = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const shutdown = createWorkerShutdown({
      stopScheduling,
      dispatch: () => dispatch.promise,
      stopQueue,
      background: () => [notifications.promise],
      disconnect,
    });
    const first = shutdown();
    expect(shutdown()).toBe(first);
    expect(stopScheduling).toHaveBeenCalledTimes(1);
    expect(stopQueue).not.toHaveBeenCalled();
    dispatch.resolve();
    await vi.waitFor(() => expect(stopQueue).toHaveBeenCalledTimes(1));
    expect(disconnect).not.toHaveBeenCalled();
    notifications.resolve();
    await first;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('continues draining and disconnects after a failure, but rejects a successful-exit claim', async () => {
    const notifications = pending();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const shutdown = createWorkerShutdown({
      stopScheduling: () => undefined,
      dispatch: () => Promise.reject(new Error('dispatch failed')),
      stopQueue: async () => {
        throw new Error('queue stop failed');
      },
      background: () => [notifications.promise],
      disconnect,
    });
    const result = shutdown();
    await Promise.resolve();
    expect(disconnect).not.toHaveBeenCalled();
    const outcome = expect(result).rejects.toThrow('did not complete cleanly');
    notifications.resolve();
    await outcome;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
