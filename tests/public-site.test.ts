import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';

afterEach(() => vi.unstubAllEnvs());
describe('public indexing', () => {
  it('lists public pages only and excludes private routes from crawler guidance', () => {
    vi.stubEnv('AUTH_URL', 'https://portfolio.example.test');
    const urls = sitemap().map((item) => item.url);
    expect(urls).toEqual([
      'https://portfolio.example.test',
      'https://portfolio.example.test/features',
      'https://portfolio.example.test/integrations',
      'https://portfolio.example.test/faq',
      'https://portfolio.example.test/contact',
      'https://portfolio.example.test/about',
      'https://portfolio.example.test/blog',
      'https://portfolio.example.test/privacy',
      'https://portfolio.example.test/terms',
      'https://portfolio.example.test/integrations/godaddy',
      'https://portfolio.example.test/integrations/afternic',
      'https://portfolio.example.test/integrations/spaceship',
      'https://portfolio.example.test/integrations/dynadot',
      'https://portfolio.example.test/integrations/namecheap',
      'https://portfolio.example.test/integrations/atom',
      'https://portfolio.example.test/integrations/atomRegistrar',
      'https://portfolio.example.test/blog/organize-domain-portfolios-across-workspaces',
      'https://portfolio.example.test/blog/domain-renewal-review-checklist',
      'https://portfolio.example.test/blog/track-domain-sales-and-installments',
      'https://portfolio.example.test/blog/organize-domain-portfolio-costs',
    ]);
    expect(urls.some((url) => /account|domains|overview|api\//.test(url))).toBe(false);
    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(false);
    if (!Array.isArray(rules)) expect(rules.disallow).toContain('/account/');
  });
});
