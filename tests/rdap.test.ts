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
      nameservers: [
        { ldhName: 'NS2.Example.COM.' },
        { ldhName: 'ns1.example.com' },
        { ldhName: 'ns1.example.com.' },
        { unicodeName: 'ns3.example.com' },
        { ldhName: 'https://invalid.example.com' },
        { ldhName: '127.0.0.1' },
        null,
      ],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    expect(await lookupRegistration('portfolio.test')).toEqual({
      registrar: 'Example Registrar',
      expiresAt: new Date('2028-01-01T00:00:00Z'),
      registeredAt: undefined,
      nameservers: ['ns1.example.com', 'ns2.example.com', 'ns3.example.com'],
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
