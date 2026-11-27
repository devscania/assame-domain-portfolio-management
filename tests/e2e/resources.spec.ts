import { browserOrigin } from './environment';
import { test, expect } from './browser-test';

test('resources and about pages are crawlable and unpublished slugs return 404', async ({
  page,
  request,
}) => {
  await page.goto('/about');
  await expect(page).toHaveTitle('About | Assame');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${browserOrigin}/about`,
  );
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Resources' })
    .click();
  await expect(page).toHaveURL(/\/blog$/);
  await page
    .getByRole('link', { name: 'How to organize domain portfolios across workspaces' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'How to organize domain portfolios across workspaces',
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${browserOrigin}/blog/organize-domain-portfolios-across-workspaces`,
  );
  const structured = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) || '{}',
  );
  expect(structured['@type']).toBe('BlogPosting');
  expect(structured.headline).toBe('How to organize domain portfolios across workspaces');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`${browserOrigin}/about`);
  expect(sitemap).toContain(`${browserOrigin}/blog/organize-domain-portfolios-across-workspaces`);
  for (const slug of [
    'domain-renewal-review-checklist',
    'track-domain-sales-and-installments',
    'organize-domain-portfolio-costs',
  ]) {
    expect(sitemap).toContain(`${browserOrigin}/blog/${slug}`);
    expect((await request.get(`/blog/${slug}`)).status()).toBe(200);
  }
  expect((await request.get('/blog/not-a-real-article')).status()).toBe(404);
});
