import { describe, expect, it, vi } from 'vitest';
import { removeSpaceshipListing } from '../src/integrations/delisting';
import { ProviderHttp } from '../src/integrations/http';

describe('Spaceship delisting transport', () => {
  it('sends one domain-scoped DELETE without a body', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const http = new ProviderHttp('https://spaceship.dev/api', {}, 0, fetcher, async () => {});
    await removeSpaceshipListing(http, 'EXAMPLE.COM');
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://spaceship.dev/api/v1/sellerhub/domains/example.com');
    expect(request.method).toBe('DELETE');
    expect(request.body).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an uncertain mutation', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('connection lost');
    });
    const http = new ProviderHttp('https://spaceship.dev/api', {}, 0, fetcher, async () => {});
    await expect(removeSpaceshipListing(http, 'example.com')).rejects.toThrow('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
