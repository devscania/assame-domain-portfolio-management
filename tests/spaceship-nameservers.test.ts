import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { actionClient } from '../src/integrations/actions';
import { ProviderHttp } from '../src/integrations/http';
import { reserveSpaceshipDomainRequest } from '../src/lib/spaceship-request-budget';
import { db } from '../src/lib/db';

describe('Spaceship nameserver transport', () => {
  it('reads the domain, reserves verification, sends one custom update and reuses the reservation', async () => {
    const reserve = vi.fn(async () => {});
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(null, { status: 204 })
        : Response.json({ name: 'example.test', nameservers: { provider: 'basic', hosts: ['NS2.example.test.', 'ns1.example.test'] } }),
    );
    const http = new ProviderHttp('https://spaceship.dev/api', {}, 0, fetcher, async () => {});
    const client = actionClient('spaceship', { apiKey: 'fake', apiSecret: 'fake' }, http, reserve);
    expect(await client.nameservers('example.test')).toEqual({ provider: 'basic', hosts: ['ns1.example.test', 'ns2.example.test'] });
    await client.setNameservers('example.test', ['ns3.example.test', 'ns4.example.test']);
    await client.nameservers('example.test');
    expect(reserve.mock.calls).toEqual([
      ['example.test', 'read'], ['example.test', 'read', true], ['example.test', 'write'],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [url, options] = fetcher.mock.calls[1];
    expect(String(url)).toBe('https://spaceship.dev/api/v1/domains/example.test/nameservers');
    expect(options?.method).toBe('PUT');
    expect(JSON.parse(String(options?.body))).toEqual({ provider: 'custom', hosts: ['ns3.example.test', 'ns4.example.test'] });
  });
  it('does not write when verification capacity cannot be reserved', async () => {
    const fetcher = vi.fn();
    const http = new ProviderHttp('https://spaceship.dev/api', {}, 0, fetcher, async () => {});
    const reserve = vi.fn(async () => { throw new Error('budget exhausted'); });
    const client = actionClient('spaceship', { apiKey: 'fake', apiSecret: 'fake' }, http, reserve);
    await expect(client.setNameservers('example.test', ['ns1.example.test', 'ns2.example.test'])).rejects.toThrow('request capacity');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('Spaceship shared rolling budget', () => {
  it('allows at most five concurrent requests per domain and keeps reads and writes separate', async () => {
    if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error('Dedicated test database required');
    const name = `${randomUUID()}.test`;
    try {
      const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => reserveSpaceshipDomainRequest(name, 'read')));
      expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
      expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(reserveSpaceshipDomainRequest(name, 'write')).resolves.toBeUndefined();
    } finally {
      const keys = ['read', 'write'].map((kind) => createHash('sha256').update(`spaceship:${kind}:${name}`).digest('hex'));
      await db.spaceshipRequestBudget.deleteMany({ where: { key: { in: keys } } });
    }
  });
});
