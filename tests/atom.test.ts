import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomAdapter, atomPage } from '../src/integrations/atom';
afterEach(() => vi.restoreAllMocks());
describe('Atom existing seller API access', () => {
  it('accepts the documented and live-observed top-level array and preserves provider status', () => {
    expect(
      atomPage([{ domain_name: 'Grandopia.com', selling_price: 9999, status: 'Seller Approved' }])
        .rows[0],
    ).toMatchObject({ name: 'grandopia.com', binPrice: '9999.00', status: 'Seller Approved' });
    expect(atomPage([]).rows).toEqual([]);
  });
  it('normalizes explicit listing fields without inventing make-offer prices', () => {
    const page = atomPage({
      success: true,
      total_records: 2,
      data: [
        { domain_name: 'EXAMPLE.test', selling_price: '2499.00' },
        { domain_name: 'offer.test', selling_price: 'Make Offer' },
      ],
    });
    expect(page.total).toBe(2);
    expect(page.rows[0]).toMatchObject({
      name: 'example.test',
      marketplace: 'atom',
      binPrice: '2499.00',
    });
    expect(page.rows[1].binPrice).toBeUndefined();
  });
  it('does not interpret a 200 error payload or unknown envelope as successful access', () => {
    expect(() => atomPage({ success: false, data: [], message: 'private-token-error' })).toThrow(
      'did not authorize',
    );
    expect(() => atomPage({ message: 'Wrong API Token' })).toThrow('not supported');
    expect(() => atomPage({ success: true, data: [{ unknown: 'record' }] })).toThrow(
      'unsupported listing',
    );
  });
  it('requires a seller user ID before making requests', () => {
    expect(() => atomAdapter({ apiKey: 'fixture-only' })).toThrow('seller user ID');
  });
  it('uses only the documented read endpoint and continues through a short page without a total', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ data: [{ domain_name: 'page-one.test', selling_price: '99' }] }),
      )
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const adapter = atomAdapter({ apiKey: 'fixture-token', userId: '12345' });
    const pages = [];
    for await (const page of adapter.pages()) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls) {
      const request = new URL(String(url));
      expect(request.origin + request.pathname).toBe(
        'https://www.atom.com/api/marketplace/domains',
      );
      expect(request.searchParams.get('user_id')).toBe('12345');
      expect(request.searchParams.get('api_token')).toBe('fixture-token');
      expect(options?.method ?? 'GET').toBe('GET');
    }
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('page')).toBe('2');
  });
  it('refuses repeated pages rather than reporting a truncated sync as complete', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ data: [{ domain_name: 'repeat.test', selling_price: 99 }] }),
    );
    const adapter = atomAdapter({ apiKey: 'fixture-token', userId: '123' });
    await expect(async () => {
      for await (const page of adapter.pages()) void page;
    }).rejects.toThrow('repeated a listing page');
  });
});
