import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionClient, actionInput } from '../src/integrations/actions';
import { providerBatchInput } from '../src/integrations/provider-batch';
import { ProviderHttp } from '../src/integrations/http';
import { readListingStats } from '../src/integrations/listing-stats';
import { atomPage } from '../src/integrations/atom';
import { atomRegistrarAdapter } from '../src/integrations/atom-registrar';
import { sedoClient } from '../src/integrations/sedo';
import { sameSnapshot } from '../src/lib/provider-changes';
const credentials = {
  apiKey: 'fixture-only-key',
  apiSecret: 'fixture-only-secret',
  userId: '12345',
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('Confirmed provider operation contracts', () => {
  it('validates unique domains and one operation type per provider batch', () => {
    const listing = { action: 'addListing', domainId: 'one', accountId: 'market', price: '1000' };
    const dns = { action: 'changeNameservers', domainId: 'two', accountId: 'registrar',
      nameservers: ['ns2.atom.com', 'ns1.atom.com'] };
    expect(providerBatchInput.parse({ items: [dns] }).items[0]).toMatchObject({
      nameservers: ['ns1.atom.com', 'ns2.atom.com'],
    });
    expect(providerBatchInput.safeParse({ items: [listing, { ...listing, domainId: 'two' }] }).success).toBe(true);
    expect(providerBatchInput.safeParse({ items: [listing, listing] }).success).toBe(false);
    expect(providerBatchInput.safeParse({ items: [listing, dns] }).success).toBe(false);
  });
  it('creates, reprices, delists and relists a Sedo domain while retaining its portfolio entry', async () => {
    const name = 'fixture.test';
    let row: Record<string, string> | undefined;
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = new URL(String(url));
      const form = init?.body as URLSearchParams;
      expect(init?.method).toBe('POST');
      expect(endpoint.search).toBe('');
      expect(form.get('password')).toBe('fixture-pass');
      calls.push(endpoint.pathname);
      if (endpoint.pathname === '/DomainList') {
        return new Response(row
          ? `<SEDODOMAINLIST><item><domain>${name}</domain><category><cat1>5</cat1></category>${Object.entries(row).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</item></SEDODOMAINLIST>`
          : '<SEDODOMAINLIST ver="1.0"/>');
      }
      row = Object.fromEntries(['forsale', 'fixedprice', 'price', 'minprice', 'currency', 'domainlanguage']
        .map((key) => [key, form.get(`domainentry[0][${key}]`) ?? '']));
      if (endpoint.pathname === '/DomainEdit') expect(form.get('domainentry[0][category][0]')).toBe('5');
      return new Response(`<SEDOLIST><item><domain>${name}</domain><status>ok</status></item></SEDOLIST>`);
    });
    const transport = new ProviderHttp('https://sedo.test', {}, 0, fetcher, async () => {});
    const credentials = { apiKey: '1', apiSecret: 'fixture-sign', apiUser: 'fixture', accountPassword: 'fixture-pass' };
    const client = actionClient('sedo', credentials, transport);
    const sedo = sedoClient(credentials, transport);
    await client.addListing(name, '2500.50');
    expect(await client.listing(name)).toMatchObject({ price: '2500.50', currency: 'USD' });
    await sedo.update(name, '3000.25', 'USD');
    await client.removeListing(name);
    expect(await client.listing(name, 'remove')).toBeNull();
    expect(await sedo.pages().next()).toMatchObject({ done: true });
    expect(row).toMatchObject({ forsale: '0', price: '3000.25' });
    await client.addListing(name, '2900');
    expect(await sedo.pages().next()).toMatchObject({
      done: false, value: [{ name, marketplace: 'sedo', status: 'listed', binPrice: '2900.00' }],
    });
    expect(calls.filter((path) => path !== '/DomainList'))
      .toEqual(['/DomainInsert', '/DomainEdit', '/DomainEdit', '/DomainEdit']);
  });
  it('reads the Atom listing tier and sends a delisting mutation once for remote reconciliation', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const request = new URL(String(url));
      if (request.pathname.endsWith('/domains')) return Response.json({
        domains: [{ domain_name: 'fixture.test', listing_type: 'Standard', status: 'Approved' }],
        total: 1,
      });
      expect(request.pathname).toBe('/api/marketplace/remove-domain');
      expect(request.searchParams.get('domain_name')).toBe('fixture.test');
      return new Response('', { status: 500 });
    });
    const client = actionClient('atom', credentials, new ProviderHttp(
      'https://atom.test/api/marketplace', {}, 0, fetcher, async () => {},
    ));
    const listing = await client.listing('fixture.test', 'remove');
    expect(listing).toMatchObject({ listingType: 'standard' });
    for (const listingType of ['premium', 'plus', undefined]) {
      await expect(client.removeListing('fixture.test', { ...listing!, listingType }))
        .rejects.toThrow('verified Standard');
    }
    await expect(client.removeListing('fixture.test', listing!)).rejects.toThrow('rejected');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('deletes an Afternic listing once and verifies a missing listing by GET', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(null, { status: 404 }),
    );
    const client = actionClient('afternic', credentials, new ProviderHttp('https://api.afternic.com', {}, 0, fetcher, async () => {}));
    await client.removeListing('FIXTURE.TEST');
    expect(await client.listing('fixture.test')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.afternic.com/v3/aftermarket/customers/my/domains/fixture.test');
    expect(fetcher.mock.calls[0][1]?.method).toBe('DELETE');
  });
  it('never retries an uncertain Afternic deletion', async () => {
    const fetcher = vi.fn(async () => { throw new Error('connection lost'); });
    const client = actionClient('afternic', credentials, new ProviderHttp('https://api.afternic.com', {}, 0, fetcher, async () => {}));
    await expect(client.removeListing('fixture.test')).rejects.toThrow('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reads and changes Namecheap registrar nameservers using a single non-retried request', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const command = new URL(String(url)).searchParams.get('Command');
      const result = command === 'namecheap.domains.dns.getList'
        ? '<DomainDNSGetListResult Domain="fixture.test"><Nameserver>NS2.example.net</Nameserver><Nameserver>ns1.example.net</Nameserver></DomainDNSGetListResult>'
        : '<DomainDNSSetCustomResult Domain="fixture.test" Updated="true" />';
      return new Response(`<ApiResponse Status="OK"><CommandResponse>${result}</CommandResponse></ApiResponse>`);
    });
    const client = actionClient('namecheap', { ...credentials, apiUser: 'fixture', clientIp: '192.0.2.1' }, new ProviderHttp('https://provider.test', {}, 0, fetcher, async () => {}));
    expect(await client.nameservers('fixture.test')).toEqual(['ns1.example.net', 'ns2.example.net']);
    await client.setNameservers('fixture.test', ['ns1.new.test', 'ns2.new.test']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('Nameservers')).toBe('ns1.new.test,ns2.new.test');
    expect(actionInput.safeParse({ action: 'changeNameservers', domainId: '1', accountId: '2', nameservers: ['ns1.new.test', 'NS1.NEW.TEST.'] }).success).toBe(false);
  });
  it('does not retry an uncertain Namecheap nameserver write', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));
    const client = actionClient('namecheap', { ...credentials, apiUser: 'fixture', clientIp: '192.0.2.1' }, new ProviderHttp('https://provider.test', {}, 0, fetcher, async () => {}));
    await expect(client.setNameservers('fixture.test', ['ns1.new.test', 'ns2.new.test'])).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry a Dynadot write or rewrite a Namecheap DNS zone', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));
    const transport = new ProviderHttp('https://provider.test', {}, 0, fetcher, async () => {});
    await expect(
      actionClient('dynadot', credentials, transport).addListing('fixture.test', '2500'),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps Atom registrar inventory on its bearer API instead of treating seller listings as registrations', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        data: [
          {
            domain_name: 'fixture.test',
            expiry_date: '2027-01-01 12:00:00',
            created_date: '2026-01-01 12:00:00',
            auto_renew: true,
            nameservers: ['ns1.atom.com', 'ns2.atom.com'],
          },
        ],
        pagination: { current_page: 1, total_pages: 1 },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const pages = [];
    for await (const page of atomRegistrarAdapter(credentials).pages()) pages.push(page);
    expect(pages[0][0]).toMatchObject({
      name: 'fixture.test',
      registrar: 'Atom',
      expiresAt: '2027-01-01T12:00:00.000Z',
      autoRenew: true,
    });
    expect(pages[0][0]).not.toHaveProperty('marketplace');
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/registrar/v1/domains');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer fixture-only-key' });
    expect(url).not.toContain('api_token');
  });
  it('creates only a BIN listing through the documented Afternic POST', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 201 }));
    const client = new ProviderHttp('https://api.afternic.com', {}, 0, fetcher, async () => {});
    await actionClient('afternic', credentials, client).addListing('fixture.test', '2500');
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.afternic.com/v3/aftermarket/customers/my/domains');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'fixture.test',
      buynowPrice: 2500000000,
    });
  });
  it('creates SellerHub listings without changing other listing settings', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 201 }));
    await actionClient(
      'spaceship',
      credentials,
      new ProviderHttp('https://spaceship.dev/api', {}, 0, fetcher, async () => {}),
    ).addListing('fixture.test', '99.25');
    const request = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'fixture.test',
      binPriceEnabled: true,
      binPrice: { amount: '99.25', currency: 'USD' },
    });
  });
  it('excludes paid Atom premium submissions and never retries mutating GET requests', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));
    const client = actionClient(
      'atom',
      credentials,
      new ProviderHttp('https://www.atom.com/api/marketplace', {}, 0, fetcher, async () => {}),
    );
    await expect(client.addListing('fixture.test', '2500')).rejects.toThrow('rejected');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetcher.mock.calls[0] as unknown as [string])[0]));
    expect(url.searchParams.get('domain_type')).toBe('standard');
    expect(url.searchParams.get('price')).toBe('2500');
  });
  it('removes TXT editing from the action schema and provider transport', () => {
    expect(actionInput.safeParse({ action: 'verificationTxt', domainId: 'd', accountId: 'a', host: '@', value: 'token' }).success).toBe(false);
    for (const provider of ['spaceship', 'atomRegistrar', 'namecheap'] as const) {
      const client = actionClient(provider, credentials);
      expect(client).not.toHaveProperty('dns');
      expect(client).not.toHaveProperty('addTxt');
      expect(client).not.toHaveProperty('verificationRecords');
    }
  });
  it('keeps missing Atom BIN prices separate from zero-priced assets and does not invent analytics', async () => {
    expect(
      atomPage([
        { domain_name: 'fixture.test', selling_price: 0, full_price: 0, status: 'Seller Approved' },
      ]).rows[0].binPrice,
    ).toBeUndefined();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ total_views: 125, total_offers: 2, total_shortlists: 4 })),
    );
    const result = await readListingStats('atom', credentials, 'fixture.test');
    expect(result).toMatchObject({ views: 125, offers: 2, shortlists: 4 });
    expect(result).not.toHaveProperty('leads');
    await expect(readListingStats('spaceship', credentials, 'fixture.test')).rejects.toThrow(
      'not exposed',
    );
  });
  it('rejects removed TXT requests and compares JSONB snapshots independent of key ordering', () => {
    expect(() =>
      actionInput.parse({
        action: 'verificationTxt',
        domainId: 'd',
        accountId: 'a',
        host: '../elsewhere',
        value: 'token',
      }),
    ).toThrow();
    expect(() =>
      actionInput.parse({
        action: 'verificationTxt',
        domainId: 'd',
        accountId: 'a',
        host: '@',
        value: 'value\nsecond',
      }),
    ).toThrow();
    expect(
      sameSnapshot(
        { nameservers: ['ns'], records: [{ type: 'TXT', value: 'x' }] },
        { records: [{ value: 'x', type: 'TXT' }], nameservers: ['ns'] },
      ),
    ).toBe(true);
    expect(sameSnapshot({ records: [{ value: 'x' }] }, { records: [{ value: 'y' }] })).toBe(false);
  });
});
