import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  providers,
  availableProviderIds,
  providerIdForName,
  isProviderId,
} from '../src/integrations/catalog';
import { providerGuides } from '../src/integrations/guides';
import { ProviderLogo } from '../src/components/provider-logo';
import { brand } from '../src/lib/brand';
import { generateMetadata, generateStaticParams } from '../src/app/integrations/[provider]/page';
import sitemap from '../src/app/sitemap';

describe('provider setup guides and local marks', () => {
  it('covers every provider with required fields, setup steps, sources and a unique indexed canonical page', async () => {
    expect(Object.keys(providerGuides).sort()).toEqual(Object.keys(providers).sort());
    expect(
      generateStaticParams()
        .map((entry) => entry.provider)
        .sort(),
    ).toEqual([...availableProviderIds].sort());
    const indexed = new Set(sitemap().map((entry) => entry.url));
    for (const id of availableProviderIds) {
      const guide = providerGuides[id as keyof typeof providers];
      expect(guide.fields.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThan(2);
      expect(guide.eligibility.length).toBeGreaterThan(20);
      expect(guide.limitations.length).toBeGreaterThan(20);
      for (const source of guide.sources) expect(new URL(source.url).protocol).toBe('https:');
      expect(
        (await generateMetadata({ params: Promise.resolve({ provider: id }) })).alternates
          ?.canonical,
      ).toBe(`/integrations/${id}`);
      expect(indexed.has(`${brand.url}/integrations/${id}`)).toBe(true);
    }
    expect(indexed.has(`${brand.url}/integrations/sedo`)).toBe(false);
    await expect(
      generateMetadata({ params: Promise.resolve({ provider: 'sedo' }) }),
    ).rejects.toThrow('404');
  });
  it('uses generic SVG icons without external assets and labels non-decorative icons', () => {
    for (const provider of availableProviderIds) {
      const markup = renderToStaticMarkup(
        createElement(ProviderLogo, { provider, decorative: false }),
      );
      expect(markup).toContain('<svg');
      expect(markup).toContain(`aria-label="${providers[provider].name}"`);
      expect(markup).not.toMatch(/(?:href|src)=/i);
    }
  });
  it('recognizes exact provider aliases without relabeling unknown or inherited names', () => {
    expect(providerIdForName('GoDaddy.com, LLC')).toBe('godaddy');
    expect(providerIdForName('SellerHub')).toBe('spaceship');
    expect(providerIdForName('Atom Registrar')).toBe('atomRegistrar');
    expect(providerIdForName('constructor')).toBeUndefined();
    expect(providerIdForName('unrelated registrar')).toBeUndefined();
    expect(isProviderId('__proto__')).toBe(false);
  });
});
