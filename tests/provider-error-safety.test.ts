import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionClient } from '../src/integrations/actions';
import { ProviderHttp } from '../src/integrations/http';
import { priceClient } from '../src/integrations/prices';
import { AppError, safeProviderError } from '../src/lib/security';

afterEach(() => vi.unstubAllGlobals());

describe('provider error disclosure', () => {
  it('never exposes arbitrary provider or transport exception messages', () => {
    const secret = 'TOKEN=private-secret&ApiKey=private-key';
    expect(safeProviderError(new Error(`https://provider.test/?${secret}`))).not.toContain(secret);
    expect(safeProviderError({ name: 'AppError', status: 400, message: secret })).not.toContain(secret);
    expect(safeProviderError(new AppError('Provider returned HTTP 403.', 502))).toBe(
      'Provider returned HTTP 403.',
    );
  });

  it('withholds raw Dynadot errors for listing and price writes', async () => {
    const raw = 'Authorization: Bearer super-secret';
    const fetcher = vi.fn(async () => Response.json({ SetForSaleResponse: { ResponseCode: 1, Error: raw } }));
    const http = new ProviderHttp('https://provider.test', {}, 0, fetcher, async () => {});
    const client = actionClient('dynadot', { apiKey: 'fixture' }, http);
    await expect(client.addListing('example.test', '100')).rejects.toThrow('Dynadot rejected listing creation');
    vi.stubGlobal('fetch', fetcher);
    await expect(priceClient('dynadot', { apiKey: 'fixture' }).update('example.test', '100', 'USD'))
      .rejects.toThrow('Dynadot rejected the price update');
  });

  it('withholds raw Namecheap DNS errors', async () => {
    const http = new ProviderHttp(
      'https://provider.test', {}, 0,
      vi.fn(async () => new Response('<ApiResponse Status="ERROR"><Errors><Error>secret token</Error></Errors></ApiResponse>')),
      async () => {},
    );
    const client = actionClient('namecheap', { apiKey: 'fixture', apiUser: 'fixture', clientIp: '192.0.2.1' }, http);
    await expect(client.nameservers('example.test')).rejects.toThrow('Namecheap did not confirm');
  });
});
