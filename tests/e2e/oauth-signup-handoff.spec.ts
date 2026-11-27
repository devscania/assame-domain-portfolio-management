import { browserUrl, browserHost } from './environment';
import { expect, test } from './browser-test';

test('consented OAuth signup waits for the analytics callback and opens the overview', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { name: 'assame-oauth-analytics', value: 'google', domain: browserHost, path: '/' },
    ]);
  await page.addInitScript(() => {
    localStorage.setItem('assame.analytics-consent.v1', 'accepted');
    sessionStorage.setItem(
      'assame.analytics-oauth-signup.v1',
      JSON.stringify({ method: 'google', at: Date.now() }),
    );
  });
  await page.route('**/api/analytics/oauth-signup', (route) =>
    route.fulfill({ json: { status: 'claimed' } }),
  );
  await page.route('https://www.googletagmanager.com/gtag/js*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
      function handle(a) {
        if (a[0] === 'event' && a[1] === 'sign_up') {
          localStorage.setItem('fixture-signup', JSON.stringify({method:a[2].method, location:a[2].page_location}));
          a[2].event_callback();
        }
      }
      window.dataLayer.forEach(handle); window.gtag = function() { handle(arguments); };
    `,
    });
  });
  await page.route('**/overview', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Overview fixture</h1>' }),
  );
  await page.goto('/oauth-complete');
  await expect(page.getByRole('heading', { name: 'Overview fixture' })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-signup') || 'null')),
  ).toEqual({ method: 'google', location: browserUrl('/oauth-complete') });
});

test('missing consent skips the handoff and rejects external return URLs', async ({ page }) => {
  await page.route('**/overview', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Overview fixture</h1>' }),
  );
  await page.goto('/oauth-complete?next=https%3A%2F%2Fevil.example');
  await expect(page.getByRole('heading', { name: 'Overview fixture' })).toBeVisible();
});
