import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { namecheapAdapter, namecheapBudget, namecheapPage } from '../src/integrations/namecheap';
import { ProviderHttp } from '../src/integrations/http';
import { assertCapability } from '../src/integrations/catalog';
import { throttle } from '../src/lib/throttle';
vi.mock('../src/lib/throttle', () => ({ throttle: vi.fn(async () => {}) }));
const fixture = readFileSync(new URL('./fixtures/namecheap.xml', import.meta.url), 'utf8');
const credentials = {
  apiKey: 'synthetic-namecheap-key',
  apiUser: 'fixture-user',
  clientIp: '203.0.113.10',
};
afterEach(() => vi.restoreAllMocks());

describe('Namecheap official registrar inventory', () => {
  it('accepts live Namecheap command casing while still rejecting unrelated commands', () => {
    const live = fixture.replace(
      '<RequestedCommand>namecheap.domains.getList',
      '<RequestedCommand>namecheap.domains.getlist',
    );
    expect(namecheapPage(live, 1).total).toBe(2);
    expect(
      namecheapPage(
        live.replace('Type="namecheap.domains.getList"', 'Type="namecheap.domains.getlist"'),
        1,
      ).rows,
    ).toHaveLength(2);
    expect(() =>
      namecheapPage(
        live.replace(
          '<RequestedCommand>namecheap.domains.getlist',
          '<RequestedCommand>namecheap.domains.getinfo',
        ),
        1,
      ),
    ).toThrow('unrecognized');
  });
  it('reads attributes, UTC calendar dates and auto-renew without inventing listings or costs', () => {
    const page = namecheapPage(fixture, 1);
    expect(page.total).toBe(2);
    expect(page.rows[0]).toEqual({
      name: 'Namecheap-Fixture.test',
      registrar: 'Namecheap',
      registeredAt: '2024-02-29T00:00:00.000Z',
      expiresAt: '2027-02-28T00:00:00.000Z',
      autoRenew: true,
    });
    expect(page.rows[1].autoRenew).toBe(false);
    expect(() => assertCapability('namecheap', 'updatePrices')).toThrow('unsupported');
    expect(() => assertCapability('namecheap', 'manageRenewals')).toThrow('unsupported');
  });
  it('accepts a verified empty account and rejects malformed or unsafe XML', () => {
    const empty = fixture
      .replace(/<DomainGetListResult>[\s\S]*?<\/DomainGetListResult>/, '<DomainGetListResult/>')
      .replace('<TotalItems>2', '<TotalItems>0');
    expect(namecheapPage(empty, 1).rows).toEqual([]);
    expect(() => namecheapPage('<ApiResponse>', 1)).toThrow('invalid');
    expect(() =>
      namecheapPage('<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + fixture, 1),
    ).toThrow('unsafe');
    expect(() => namecheapPage('<html>not inventory</html>', 1)).toThrow('did not authorize');
    expect(() => namecheapPage(fixture.replace('02/29/2024', '02/30/2024'), 1)).toThrow(
      'no date was guessed',
    );
  });
  it('rejects API-level errors on HTTP 200 without echoing secrets', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          '<ApiResponse Status="ERROR"><Errors><Error Number="1017105">synthetic-namecheap-key invalid</Error></Errors></ApiResponse>',
        ),
    );
    const client = new ProviderHttp('https://api.namecheap.com', {}, 0, fetcher, async () => {});
    const connection = namecheapAdapter(credentials, client);
    await expect(connection.test()).rejects.toThrow('code 1017105');
    await expect(connection.test()).rejects.not.toThrow(credentials.apiKey);
  });
  it('paginates using the provider page size and only sends documented read commands', async () => {
    const requests: URL[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request = new URL(String(url));
      requests.push(request);
      expect(init?.headers).toMatchObject({ Accept: 'application/xml' });
      const page = Number(request.searchParams.get('Page'));
      const count = page === 1 ? 10 : 1;
      return new Response(
        `<ApiResponse Status="OK"><Errors/><RequestedCommand>namecheap.domains.getList</RequestedCommand><CommandResponse Type="namecheap.domains.getList"><DomainGetListResult>${Array.from({ length: count }, (_, i) => `<Domain Name="fixture-${(page - 1) * 10 + i}.test"/>`).join('')}</DomainGetListResult><Paging><TotalItems>11</TotalItems><CurrentPage>${page}</CurrentPage><PageSize>10</PageSize></Paging></CommandResponse></ApiResponse>`,
      );
    });
    const client = new ProviderHttp('https://api.namecheap.com', {}, 0, fetcher, async () => {});
    const pages = [];
    for await (const page of namecheapAdapter(credentials, client).pages()) pages.push(page);
    expect(pages.map((p) => p.length)).toEqual([10, 1]);
    expect(requests.map((r) => r.searchParams.get('Page'))).toEqual(['1', '2']);
    expect(requests[0].searchParams.get('UserName')).toBe(credentials.apiUser);
    expect(requests[0].searchParams.get('ClientIp')).toBe(credentials.clientIp);
    expect(
      requests.every((r) => r.searchParams.get('Command') === 'namecheap.domains.getList'),
    ).toBe(true);
  });
  it('fails incomplete, repeated or unrelated responses instead of reporting success', () => {
    expect(() => namecheapPage(fixture, 2)).toThrow('pagination');
    expect(() => namecheapPage(fixture.replace('<TotalItems>2', '<TotalItems>5'), 1)).toThrow(
      'pagination',
    );
    expect(() =>
      namecheapPage(
        fixture.replaceAll('namecheap.domains.getList', 'namecheap.domains.getInfo'),
        1,
      ),
    ).toThrow('unrecognized');
  });
  it('validates required credentials before any network access', () => {
    expect(() => namecheapAdapter({ apiKey: 'fixture-only' })).toThrow('allowlisted IPv4');
    expect(() => namecheapAdapter({ ...credentials, clientIp: '::1' })).toThrow('allowlisted IPv4');
  });
  it('retries rate-limited read requests and applies the shared budget to each attempt', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(fixture));
    const budget = vi.fn(async () => {});
    const wait = vi.fn(async (milliseconds: number) => {
      void milliseconds;
    });
    await namecheapAdapter(
      credentials,
      new ProviderHttp('https://api.namecheap.com', {}, 0, fetcher, wait, budget),
    ).test();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(budget).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls.some((call) => Number(call[0]) >= 1000)).toBe(true);
  });
  it('shares hashed per-key minute, hour and day budgets', async () => {
    vi.mocked(throttle).mockClear();
    await namecheapBudget(credentials.apiKey);
    expect(vi.mocked(throttle).mock.calls.map((call) => call.slice(1))).toEqual([
      [45, 60],
      [650, 3600],
      [7500, 86400],
    ]);
    expect(JSON.stringify(vi.mocked(throttle).mock.calls)).not.toContain(credentials.apiKey);
  });
});
