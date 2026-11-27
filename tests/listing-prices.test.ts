import { afterEach, describe, expect, it, vi } from 'vitest';
import { priceClient, validateListingPrice, samePrice } from '../src/integrations/prices';
import { requirePublishing } from '../src/lib/listing-prices';
import { canEditListingPrice, listingStatusLabel } from '../src/integrations/listing-status';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('provider BIN mutation contracts', () => {
  it('allows both Atom approval states without admitting other non-active listings', () => {
    for (const status of ['Approved', 'Seller Approved']) {
      expect(canEditListingPrice('atom', status)).toBe(true);
      expect(canEditListingPrice('afternic', status)).toBe(false);
      expect(listingStatusLabel('atom', status)).toBe('Approved');
    }
    for (const status of ['Pending', 'Rejected', 'Sold', 'Unknown']) {
      expect(canEditListingPrice('atom', status)).toBe(false);
    }
  });
  it('enforces both deployment and workspace opt-in', () => {
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'false');
    expect(() => requirePublishing({ demo: false, pricePublishingEnabled: true })).toThrow();
    vi.stubEnv('PROVIDER_WRITES_ENABLED', 'true');
    expect(() => requirePublishing({ demo: false, pricePublishingEnabled: false })).toThrow();
    expect(() => requirePublishing({ demo: true, pricePublishingEnabled: true })).toThrow();
    expect(() => requirePublishing({ demo: false, pricePublishingEnabled: true })).not.toThrow();
  });
  it('validates provider currency and exact whole-dollar restrictions', () => {
    expect(() => validateListingPrice('afternic', '4999.25', 'USD')).toThrow();
    expect(() => validateListingPrice('afternic', '4999', 'EUR')).toThrow();
    expect(() => validateListingPrice('atom', '0', 'USD')).toThrow();
    expect(() => validateListingPrice('spaceship', '99.25', 'USD')).not.toThrow();
    expect(samePrice('99', '99.00')).toBe(true);
  });
  it('updates Afternic using microunits and only the BIN field', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await priceClient('afternic', { apiKey: 'fixture', apiSecret: 'fixture' }).update(
      'example.test',
      '4999',
      'USD',
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ buynowPrice: 4999000000 });
    expect(fetcher.mock.calls[0][1]?.method).toBe('PATCH');
  });
  it('updates SellerHub using decimal strings and currency', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
    await priceClient('spaceship', { apiKey: 'fixture', apiSecret: 'fixture' }).update(
      'example.test',
      '99.25',
      'USD',
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      binPriceEnabled: true,
      binPrice: { amount: '99.25', currency: 'USD' },
    });
  });
  it('uses Atom’s documented price endpoint without automatically retrying its mutating GET', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('fixture network error'));
    await expect(
      priceClient('atom', { apiKey: 'fixture-token', userId: '123' }).update(
        'example.test',
        '4999',
        'USD',
      ),
    ).rejects.toThrow('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/marketplace/update-selling-price');
    expect(url.searchParams.get('selling_price')).toBe('4999');
    expect(url.searchParams.get('user_id')).toBe('123');
  });
  it.each([
    [{ message: 'Selling price must be within the allowed range.' }, 'allowed price range'],
    [{ success: false, message: 'Invalid API token: fixture-secret' }, 'pricing access'],
    [{ status: 'failed', error: 'fixture-secret' }, 'pricing rules'],
  ])('reports an explicit Atom rejection without exposing the response', async (body, reason) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body));
    const update = priceClient('atom', { apiKey: 'fixture-token', userId: '123' }).update(
      'example.test',
      '4999',
      'USD',
    );
    await expect(update).rejects.toThrow(reason);
    await expect(update).rejects.not.toThrow('fixture-secret');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [200, { message: 'Maximum allowed price is $42,000.' }, 'Enter $42,000 or less'],
    [422, { max_price: 42000 }, 'Enter $42,000 or less'],
    [422, { success: false, min_price: '10000', max_price: 42000 }, 'between $10,000 and $42,000'],
    [
      400,
      { message: 'Selling price must be between USD 10,000 and $42,000.' },
      'between $10,000 and $42,000',
    ],
    [
      422,
      { message: 'Selling price must be within the allowed range. Requested price was $49,988.' },
      'Check the listing’s allowed price range',
    ],
  ])(
    'shows an actionable Atom price limit when provided (HTTP %i)',
    async (status, body, reason) => {
      const fetcher = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json(body, { status }));
      await expect(
        priceClient('atom', { apiKey: 'fixture-token', userId: '123' }).update(
          'example.test',
          '49988',
          'USD',
        ),
      ).rejects.toThrow(reason);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('accepts the documented Atom acknowledgement and recognizes Premium on an exact detail read', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith('/domain-details')
        ? Response.json({
            domain_name: 'example.test',
            selling_price: 41795,
            listing_type: 'Premium',
            status: 'Approved',
          })
        : Response.json({ message: 'Successfully updated selling price' });
    });
    const credentials = { apiKey: 'fixture-token', userId: '123' };
    await expect(
      priceClient('atom', credentials).update('example.test', '4999', 'USD'),
    ).resolves.toBeUndefined();
    await expect(priceClient('atom', credentials).read('example.test')).resolves.toMatchObject({
      name: 'example.test',
      price: '41795.00',
      listingType: 'Premium',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reads and updates Dynadot marketplace listings via set_for_sale', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
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
      if (url.includes('command=set_for_sale')) {
        return Response.json({
          SetForSaleResponse: {
            ResponseCode: 0,
            Status: 'success',
          },
        });
      }
      return Response.json({ Response: { ResponseCode: -1, Error: 'unexpected command' } });
    });
    const client = priceClient('dynadot', { apiKey: 'test-dyn-key' });
    const current = await client.read('amba.si');
    expect(current).toEqual({
      name: 'amba.si',
      price: '9888.00',
      currency: 'USD',
      status: 'listed',
    });
    await client.update('amba.si', '12500.00', 'USD');
    const updateCall = fetcher.mock.calls.find((call) =>
      String(call[0]).includes('command=set_for_sale'),
    );
    expect(updateCall).toBeTruthy();
    const updateUrl = new URL(String(updateCall![0]));
    expect(updateUrl.searchParams.get('domains')).toBe('amba.si');
    expect(updateUrl.searchParams.get('price')).toBe('12500.00');
    expect(updateUrl.searchParams.get('for_sale_type')).toBe('marketplace');
    expect(updateUrl.searchParams.get('listing_type')).toBe('buy_now');
    expect(updateUrl.searchParams.get('category')).toBe('other');
    expect(updateUrl.searchParams.get('currency')).toBe('USD');
  });
});
