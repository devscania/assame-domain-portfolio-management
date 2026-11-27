import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const resolver = vi.hoisted(() => ({ resolveNs: vi.fn(), cancel: vi.fn() }));
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    resolveNs = resolver.resolveNs;
    cancel = resolver.cancel;
  },
}));
import { lookupPublicNameservers, normalizeNameservers } from '../src/lib/public-nameservers';

beforeEach(() => {
  resolver.resolveNs.mockReset();
  resolver.cancel.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('public nameserver observations', () => {
  it('normalizes and deduplicates hostnames while rejecting URLs and IP addresses', async () => {
    resolver.resolveNs.mockResolvedValue([
      'NS2.EXAMPLE.COM.',
      'ns1.example.com',
      'ns1.example.com.',
      'https://invalid.test',
      '127.0.0.1',
    ]);
    expect(await lookupPublicNameservers('Portfolio.TEST.')).toEqual([
      'ns1.example.com',
      'ns2.example.com',
    ]);
    expect(resolver.resolveNs).toHaveBeenCalledWith('portfolio.test');
    expect(normalizeNameservers([null, 42, 'ns.bücher.test'])).toEqual(['ns.xn--bcher-kva.test']);
  });
  it('returns no fabricated values when DNS has no answer and rejects invalid domain input', async () => {
    resolver.resolveNs.mockRejectedValue(new Error('ENODATA'));
    expect(await lookupPublicNameservers('portfolio.test')).toEqual([]);
    await expect(lookupPublicNameservers('https://portfolio.test')).rejects.toThrow();
    expect(resolver.resolveNs).toHaveBeenCalledTimes(1);
  });
  it('cancels a stalled resolver so lookup jobs can finish within their lease', async () => {
    vi.useFakeTimers();
    resolver.resolveNs.mockImplementation(
      () =>
        new Promise<string[]>((_resolve, reject) => {
          resolver.cancel.mockImplementation(() => reject(new Error('ECANCELLED')));
        }),
    );
    const pending = lookupPublicNameservers('portfolio.test');
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toEqual([]);
    expect(resolver.cancel).toHaveBeenCalledOnce();
  });
});
