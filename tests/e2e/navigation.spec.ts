import { test, expect } from './browser-test';

test('dashboard stays loaded and favicon requests bypass authentication', async ({
  page,
  request,
}) => {
  const favicon = await request.get('/favicon.ico', { maxRedirects: 0 });
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['content-type']).toContain('image/svg+xml');

  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@assame.local');
  await page.getByLabel(/^Password/).fill('AssameDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  let documentRequests = 0;
  page.on('request', (event) => {
    if (event.resourceType() === 'document') documentRequests++;
  });
  await page.waitForTimeout(15000);
  expect(documentRequests).toBe(0);
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
});
