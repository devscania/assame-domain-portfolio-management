import { expect, it, vi } from 'vitest';
import { lookupRegistration } from '@/lib/rdap';

it('uses the registry for the domain and extracts its published registrar and expiry', async () => {
  const fetcher = vi.fn(async (url: URL) => {
    if (url.hostname === 'data.iana.org') {
      return Response.json({ services: [[['test'], ['https://registry.example/rdap/']]] });
    }
    return Response.json({
      objectClassName: 'domain',
      ldhName: 'portfolio.test',
      entities: [
        { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Ignored contact']]] },
        { roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]] },
      ],
      events: [{ eventAction: 'expiration', eventDate: '2028-01-01' }],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    expect(await lookupRegistration('portfolio.test')).toEqual({
      registrar: 'Example Registrar',
      expiresAt: new Date('2028-01-01T00:00:00Z'),
      registeredAt: undefined,
    });
    expect(fetcher.mock.calls[1][0].href).toBe(
      'https://registry.example/rdap/domain/portfolio.test',
    );
    expect(await lookupRegistration('different.test')).toBeNull();
    expect(await lookupRegistration('portfolio.gg')).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
