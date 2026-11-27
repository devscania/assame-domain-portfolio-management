import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/throttle', () => ({ throttle: vi.fn(async () => undefined) }));
import { godaddyAdapter, godaddyNextPath } from '../src/integrations/godaddy';
import { ProviderHttp } from '../src/integrations/http';
import { adapter } from '../src/integrations/adapters';
import { providers } from '../src/integrations/catalog';

const item = { domain: 'example.test', status: 'ACTIVE', expiresAt: '2027-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z', autoRenew: false, nameServers: ['ns1.example.test'] };
const first = '/v3/domains/domain-names?pageSize=200&lifecycleGroups=REGISTERED%2CPENDING_TERMINAL';
function client(responses: unknown[]) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(responses.shift()));
  return { http: new ProviderHttp('https://api.godaddy.com', { Authorization: 'Bearer fixture' }, 0, fetcher, async () => undefined), fetcher };
}
async function collect(value: ReturnType<typeof godaddyAdapter>) {
  const result = [];
  for await (const page of value.pages()) result.push(...page);
  return result;
}
afterEach(() => vi.unstubAllGlobals());

describe('GoDaddy read-only PAT inventory', () => {
  it('uses the account PAT on the fixed v3 endpoint without a shopper override or mutation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [item], links: [] }));
    vi.stubGlobal('fetch', fetcher);
    await adapter('godaddy', { apiKey: 'fixture-token', userId: '999' }).test();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.godaddy.com${first}`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
    expect(init.headers).not.toHaveProperty('X-Shopper-Id');
    expect(init.method).toBeUndefined();
    expect(init.redirect).toBe('error');
    expect(providers.godaddy.capabilities).toMatchObject({ readInventory: true, readExpiration: true, manageNameservers: false, manageRenewals: false, updatePrices: false });
  });
  it('follows only a validated forward cursor and maps registrar observations without sales or writes', async () => {
    const fixture = client([{ items: [item], links: [{ rel: 'next', href: '/v3/domains/domain-names?pageSize=200&pageToken=page-2' }] },
      { items: [{ domain: 'other.test', status: 'EXPIRED' }], links: [{ rel: 'self', href: first }] }]);
    const value = godaddyAdapter({ apiKey: 'fixture' }, fixture.http);
    const rows = await collect(value);
    expect(rows).toEqual([{ name: 'example.test', registrar: 'GoDaddy', expiresAt: item.expiresAt,
      registeredAt: item.createdAt, autoRenew: false, nameservers: item.nameServers },
    { name: 'other.test', registrar: 'GoDaddy' }]);
    expect(String(fixture.fetcher.mock.calls[1]?.[0])).toContain('pageToken=page-2');
    expect(value.sales).toBeUndefined();
  });
  it.each([
    'https://attacker.test/v3/domains/domain-names?pageToken=x',
    '//attacker.test/v3/domains/domain-names?pageToken=x',
    'https://user:password@api.godaddy.com/v3/domains/domain-names?pageToken=x',
    '/v3/domains/domain-names/example.test?pageToken=x',
    '/v3/domains/domain-names?pageToken=x&pageToken=y',
    '/v3/domains/domain-names?pageToken=x&pageTokenDirection=backward',
    '/v3/domains/domain-names?pageToken=x&lifecycleGroups=TERMINAL',
    '/v3/domains/domain-names?pageToken=x&pageSize=201',
    '/v3/domains/domain-names?pageToken=x&shopperId=other',
    '/v3/domains/domain-names?pageToken=x#ignored',
  ])('rejects an unsafe or scope-changing pagination URL: %s', (href) => {
    expect(() => godaddyNextPath([{ rel: 'next', href }])).toThrow();
  });
  it('rejects missing navigation, duplicate domains, repeated cursors and empty non-final pages', async () => {
    for (const responses of [
      [{ items: [item] }],
      [{ items: [item, item], links: [] }],
      [{ items: [], links: [{ rel: 'next', href: `${first}&pageToken=x` }] }],
      [{ items: [item], links: [{ rel: 'next', href: `${first}&pageToken=x` }] },
        { items: [{ ...item, domain: 'other.test' }], links: [{ rel: 'next', href: `${first}&pageToken=x` }] }],
    ]) {
      const fixture = client(responses);
      await expect(collect(godaddyAdapter({ apiKey: 'fixture' }, fixture.http))).rejects.toThrow();
    }
  });
  it('rejects malformed tokens before attempting network access', () => {
    expect(() => godaddyAdapter({ apiKey: 'bad\r\ntoken' })).toThrow('Personal Access Token');
  });
  it('does not follow an HTTP redirect or echo a provider rejection body', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('fixture-sensitive-rejection', {
      status: 302, headers: { location: 'https://attacker.test/steal' },
    }));
    vi.stubGlobal('fetch', fetcher);
    await expect(godaddyAdapter({ apiKey: 'fixture-token' }).test()).rejects.toThrow('HTTP 302');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
