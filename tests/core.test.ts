import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeDomain,
  installments,
  sum,
  financials,
  conflict,
  domainInput,
  installmentDueDate,
} from '../src/lib/domain';
import { encrypt, decrypt, assertOrigin, createLogger } from '../src/lib/security';
import { assertCapability } from '../src/integrations/catalog';
import { ProviderHttp, retryDelay } from '../src/integrations/http';
import { afternicNormalize, adapter } from '../src/integrations/adapters';
import { parseCsv } from '../src/lib/portfolio';
import { requireRole } from '../src/lib/permissions';
afterEach(() => vi.unstubAllEnvs());
describe('domain identity and CSV', () => {
  it('normalizes case, whitespace, trailing dot and IDNs', () => {
    expect(normalizeDomain('  BÜCHER.de. ').name).toBe('xn--bcher-kva.de');
    expect(normalizeDomain('Example.COM').name).toBe('example.com');
  });
  it.each([
    'https://example.com',
    'example.com/path',
    'example.com:80',
    '-bad.com',
    'one..com',
    '127.0.0.1',
    'localhost',
  ])('rejects non-domain input %s', (name) => expect(() => normalizeDomain(name)).toThrow());
  it('deduplicates normalized domains and skips invalid rows', () => {
    const parsed = parseCsv(
      'Domain,Price\nEXAMPLE.com,99.50\nexample.COM,12\nhttps://bad.test,4\ngood.test,10.25',
      { name: 'Domain', askingPrice: 'Price' },
    );
    expect(parsed.valid).toHaveLength(2);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.valid[0].askingPrice).toBe('99.50');
  });
  it('handles quoted commas and semicolon tags', () => {
    const parsed = parseCsv('domain,tags\n"example.test","short; brandable"', {
      name: 'domain',
      tags: 'tags',
    });
    expect(parsed.valid[0].tags).toEqual(['short', 'brandable']);
  });
  it('rejects fractional cents and negative acquisition costs', () => {
    expect(domainInput.safeParse({ name: 'x.test', acquisitionCost: '1.001' }).success).toBe(false);
    expect(domainInput.safeParse({ name: 'x.test', acquisitionCost: '-1' }).success).toBe(false);
  });
});
describe('exact financial accounting', () => {
  it('clamps month-end installments without drifting into the following month', () => {
    expect(installmentDueDate('2026-01-31', 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(installmentDueDate('2026-01-31', 2).toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });
  it('does not use binary floating point for currency sums', () =>
    expect(sum(['0.1', '0.2'])).toBe('0.30'));
  it('allocates all cents of a 1545 agreement across 17 installments', () => {
    const result = installments('1545', 17);
    expect(result).toHaveLength(17);
    expect(sum(result)).toBe('1545.00');
    expect(result[0]).toBe('90.89');
    expect(result[16]).toBe('90.88');
  });
  it('does not turn a signed LTO agreement into collected revenue', () =>
    expect(financials('1545', ['90.89'], ['154.50'], '12.98', false)).toEqual({
      collected: '90.89',
      unpaid: '1454.11',
      net: '-63.61',
      realizedProfit: '0.00',
    }));
  it('computes realized profit only for collected sales', () =>
    expect(financials('1000', ['1000'], ['150'], '100', true).realizedProfit).toBe('750.00'));
  it('settles gross agreements with net payouts and withheld fees without charging fees twice', () => {
    expect(financials('500', ['475'], ['25'], '12', true, ['25'])).toEqual({
      collected: '475.00',
      unpaid: '0.00',
      net: '475.00',
      realizedProfit: '463.00',
    });
  });
  it('detects price and currency mismatches without coercing unknown prices', () => {
    expect(
      conflict([
        { binPrice: '99.00', currency: 'USD' },
        { binPrice: '99', currency: 'USD' },
      ]),
    ).toBe(false);
    expect(
      conflict([
        { binPrice: '99', currency: 'USD' },
        { binPrice: '99', currency: 'EUR' },
      ]),
    ).toBe(true);
    expect(conflict([{ binPrice: null, currency: 'USD' }])).toBe(false);
  });
});
describe('security and capabilities', () => {
  it('uses authenticated encryption with a fresh nonce and detects tampering', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'ab'.repeat(32));
    const a = encrypt({ apiKey: 'private' });
    const b = encrypt({ apiKey: 'private' });
    expect(a).not.toBe(b);
    expect(a).not.toContain('private');
    expect(decrypt(a)).toEqual({ apiKey: 'private' });
    const parts = a.split('.');
    parts[1] = Buffer.alloc(16).toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('refuses missing encryption keys', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', '');
    expect(() => encrypt('secret')).toThrow();
  });
  it('blocks cross-origin writes', () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');
    expect(() =>
      assertOrigin(
        new Request('http://localhost:3000/api/console', {
          headers: { origin: 'https://evil.test' },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertOrigin(
        new Request('http://localhost:3000/api/console', {
          headers: { origin: 'http://localhost:3000' },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertOrigin(
        new Request('http://127.0.0.1:3001/api/console', {
          headers: { origin: 'http://127.0.0.1:3001', host: '127.0.0.1:3001' },
        }),
      ),
    ).not.toThrow();
  });
  it('enforces editor, admin and owner boundaries', () => {
    expect(() => requireRole({ role: 'VIEWER' })).toThrow();
    expect(() => requireRole({ role: 'EDITOR' }, 'ADMIN')).toThrow();
    expect(() => requireRole({ role: 'ADMIN' }, 'OWNER')).toThrow();
    expect(() => requireRole({ role: 'OWNER' }, 'ADMIN')).not.toThrow();
  });
  it('reports supported listing removal and unavailable registrar operations for Atom marketplace', () => {
    expect(() => assertCapability('afternic', 'removeListings')).not.toThrow();
    expect(() => assertCapability('atom', 'removeListings')).not.toThrow();
    expect(() => assertCapability('sedo', 'removeListings')).not.toThrow();
    expect(() => assertCapability('atom', 'manageNameservers')).toThrow();
    expect(() => assertCapability('spaceship', 'readInventory')).not.toThrow();
  });
  it('redacts credential fields from structured log records', () => {
    let line = '';
    const log = createLogger({
      write(chunk: string) {
        line += chunk;
      },
    });
    log.info(
      {
        apiKey: 'never-print-key',
        apiSecret: 'never-print-secret',
        authorization: 'never-print-auth',
        api_token: 'never-print-token',
        password: 'never-print-password',
        safe: 'visible',
      },
      'test',
    );
    expect(line).not.toContain('never-print');
    expect(line).toContain('[REDACTED]');
    expect(line).toContain('visible');
  });
});
describe('provider contracts and recovery', () => {
  it('converts Afternic microunits rather than treating them as dollars', () =>
    expect(
      afternicNormalize({
        name: 'example.test',
        buynowPrice: 5000000000,
        minbidPrice: 100000000,
        listStatus: 'ACTIVE',
      }).binPrice,
    ).toBe('5000.00'));
  it('honors retry-after seconds and HTTP dates', () => {
    expect(retryDelay(0, '10')).toBeGreaterThanOrEqual(10000);
    expect(retryDelay(0, 'Thu, 01 Jan 1970 00:01:00 GMT', 0)).toBe(60000);
  });
  it('retries 429 and transient 503 responses before accepting real data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    const wait = vi.fn(async (_ms: number) => {
      void _ms;
    });
    const client = new ProviderHttp('https://provider.test', {}, 0, fetcher, wait);
    expect(await client.get('/inventory')).toEqual({ items: [] });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.some((v) => Number(v[0]) >= 2000)).toBe(true);
  });
  it('never claims completion for an asynchronous 202 or authentication failure', async () => {
    const pending = new ProviderHttp(
      'https://provider.test',
      {},
      0,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 202 })),
      async () => {},
    );
    await expect(pending.get('/domains')).rejects.toThrow('pending');
    const denied = new ProviderHttp(
      'https://provider.test',
      {},
      0,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{"secret":"no"}', { status: 401 })),
      async () => {},
    );
    await expect(denied.get('/domains')).rejects.toThrow('HTTP 401');
  });
  it('supports Dynadot RESTful v2 X-Signature signing and maps error envelopes clearly', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api3.json')) {
        return Response.json({
          Response: { ResponseCode: '-1', Error: 'invalid key' },
        });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer dyn-restful-key');
      const requestId = headers.get('X-Request-Id');
      expect(requestId).toBeTruthy();
      const { pathname, search } = new URL(url);
      const expectedSignature = createHmac('sha256', 'dyn-secret-key')
        .update(`dyn-restful-key\n${pathname}${search}\n${requestId}\n`)
        .digest('base64');
      if (headers.get('X-Signature') !== expectedSignature)
        return new Response(null, { status: 401 });
      return Response.json({
        code: 200,
        data: {
          domain_info_list: [
            {
              domain_name: 'detach.si',
              expiration_date: '2027-10-06T00:00:00Z',
              registration_date: '2025-10-06T00:00:00Z',
            },
          ],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const dynadot = adapter('dynadot', {
      apiKey: 'dyn-restful-key',
      apiSecret: 'dyn-secret-key',
    });
    const rows = [];
    for await (const page of dynadot.pages()) rows.push(...page);
    expect(rows).toEqual([
      {
        name: 'detach.si',
        registrar: 'Dynadot',
        expiresAt: '2027-10-06T00:00:00.000Z',
        registeredAt: '2025-10-06T00:00:00.000Z',
      },
    ]);
    const missingSecret = adapter('dynadot', { apiKey: 'dyn-restful-key' });
    await expect(missingSecret.test()).rejects.toThrow(/Secret Key/i);
    vi.unstubAllGlobals();
  });
  it('imports active Dynadot marketplace listings and BIN prices when isForSale is yes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('command=list_domain')) {
        return Response.json({
          ListDomainInfoResponse: {
            ResponseCode: 0,
            Status: 'success',
            MainDomains: [
              {
                Name: 'amba.si',
                Expiration: '1821925650000',
                Registration: '1790389650000',
                isForSale: 'yes',
              },
              {
                Name: 'notsale.si',
                Expiration: '1821925650000',
                Registration: '1790389650000',
                isForSale: 'no',
              },
            ],
          },
        });
      }
      if (url.includes('command=get_listing_item')) {
        return Response.json({
          GetListingsItemResponse: {
            ResponseCode: 0,
            Status: 'success',
            Listing: {
              Domain: 'amba.si',
              Price: '9888.00',
              Type: 'Buy Now + Make Offer',
            },
          },
        });
      }
      return Response.json({ Response: { ResponseCode: -1, Error: 'unexpected command' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const dynadot = adapter('dynadot', { apiKey: 'dyn-key' });
    const rows = [];
    for await (const page of dynadot.pages()) rows.push(...page);
    expect(rows).toEqual([
      {
        name: 'amba.si',
        registrar: 'Dynadot',
        expiresAt: '2027-09-26T02:27:30.000Z',
        registeredAt: '2026-09-26T02:27:30.000Z',
        marketplace: 'dynadot',
        status: 'listed',
        binPrice: '9888.00',
        currency: 'USD',
      },
      {
        name: 'notsale.si',
        registrar: 'Dynadot',
        expiresAt: '2027-09-26T02:27:30.000Z',
        registeredAt: '2026-09-26T02:27:30.000Z',
      },
    ]);
    vi.unstubAllGlobals();
  });
});
