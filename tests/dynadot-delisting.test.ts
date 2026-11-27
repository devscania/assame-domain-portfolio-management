import { describe, expect, it, vi } from 'vitest';
import { actionClient } from '../src/integrations/actions';
import { ProviderHttp } from '../src/integrations/http';

const credentials = { apiKey: 'fixture-key' };
const info = (status = 'active', sale = 'yes') => ({
  DomainInfoResponse: { ResponseCode: 0, Status: 'success', DomainInfo: { Name: 'fixture.test', Status: status, isForSale: sale } },
});
const listing = (locked = 'No') => ({
  GetListingsItemResponse: { ResponseCode: 0, Status: 'success', Listing: {
    Domain: 'fixture.test', ListingId: 'listing-123', Type: 'BIN', Price: '250', PendingSaleLocked: locked,
  } },
});
describe('Dynadot confirmed listing removal', () => {
  it('uses ownership and unlocked-listing evidence, sends a single cancellation and verifies absence', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const command = url.searchParams.get('command');
      if (command === 'domain_info') return Response.json(info('active', fetcher.mock.calls.length > 3 ? 'no' : 'yes'));
      if (command === 'get_listing_item') return Response.json(listing());
      if (command === 'set_for_sale') return Response.json({ SetForSaleResponse: { ResponseCode: 0, Status: 'success' } });
      throw new Error('Unexpected request');
    });
    const client = actionClient('dynadot', credentials, new ProviderHttp('https://api.dynadot.com', {}, 0, fetcher, async () => {}));
    expect(await client.listing('fixture.test', 'remove')).toMatchObject({ listingId: 'listing-123', listingType: 'bin' });
    await client.removeListing('fixture.test');
    expect(await client.listing('fixture.test', 'remove')).toBeNull();
    const mutation = fetcher.mock.calls.find((call) => new URL(String(call[0])).searchParams.get('command') === 'set_for_sale');
    expect(mutation).toBeDefined();
    const url = new URL(String(mutation![0]));
    expect(url.searchParams.get('for_sale_type')).toBe('not_for_sale');
    expect(url.searchParams.get('domains')).toBe('fixture.test');
    expect(fetcher.mock.calls.filter((call) => new URL(String(call[0])).searchParams.get('command') === 'set_for_sale')).toHaveLength(1);
  });
  it('rejects pending sales and non-active domains before removal', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      Response.json(new URL(String(input)).searchParams.get('command') === 'domain_info' ? info() : listing('Yes')),
    );
    const client = actionClient('dynadot', credentials, new ProviderHttp('https://api.dynadot.com', {}, 0, fetcher, async () => {}));
    await expect(client.listing('fixture.test', 'remove')).rejects.toThrow('unlocked');
    fetcher.mockImplementation(async () => Response.json(info('moved (sold)', 'no')));
    await expect(client.listing('fixture.test', 'remove')).rejects.toThrow('active registrar');
  });
  it('does not retry an uncertain write', async () => {
    const fetcher = vi.fn(async () => { throw new Error('connection lost'); });
    const client = actionClient('dynadot', credentials, new ProviderHttp('https://api.dynadot.com', {}, 0, fetcher, async () => {}));
    await expect(client.removeListing('fixture.test')).rejects.toThrow('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
