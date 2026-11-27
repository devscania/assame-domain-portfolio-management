import { browserOrigin } from './environment';
import { expect, test } from './browser-test';

test('public policies are navigable and indexed', async ({ page, request }) => {
  await page.goto('/');
  const footer = page.getByRole('navigation', { name: 'Footer navigation' });
  for (const [label, path] of [
    ['Privacy', '/privacy'],
    ['Terms', '/terms'],
  ] as const) {
    await expect(footer.getByRole('link', { name: label })).toHaveAttribute('href', path);
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`${browserOrigin}${path}`);
  }
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of ['/privacy', '/terms']) expect(sitemap).toContain(`${browserOrigin}${path}`);
});
