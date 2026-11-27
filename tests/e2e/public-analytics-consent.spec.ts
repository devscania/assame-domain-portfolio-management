import { browserUrl } from './environment';
import { test, expect } from './browser-test';

test('analytics requires consent and records only sanitized public paths', async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID !== 'G-TEST123',
    'Requires the test measurement ID',
  );
  let tagRequests = 0;
  await page.route('https://www.googletagmanager.com/gtag/js*', async (route) => {
    tagRequests++;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.goto('/features?email=person@example.test&token=secret');
  await expect(page.getByRole('complementary', { name: 'Analytics preferences' })).toBeVisible();
  expect(tagRequests).toBe(0);
  await page.getByRole('button', { name: 'Reject analytics' }).click();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Analytics preferences' })).toHaveCount(0);
  expect(tagRequests).toBe(0);
  await page.getByRole('button', { name: 'Analytics preferences' }).click();
  await page.getByRole('button', { name: 'Accept analytics' }).click();
  await expect.poll(() => tagRequests).toBe(1);
  const events = await page.evaluate(() =>
    (window as unknown as { dataLayer: IArguments[] }).dataLayer.map((entry) => Array.from(entry)),
  );
  expect(events[0][0]).toBe('consent');
  expect(events[0][1]).toBe('default');
  expect(events[0][2]).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied' });
  const views = events.filter((entry) => entry[0] === 'event' && entry[1] === 'page_view');
  expect(views).toHaveLength(1);
  expect(views[0][2]).toMatchObject({
    page_location: browserUrl('/features'),
    page_referrer: '',
  });
  expect(JSON.stringify(events)).not.toContain('person@example.test');
  expect(JSON.stringify(events)).not.toContain('secret');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'FAQ', exact: true })
    .click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as unknown as { dataLayer: IArguments[] }).dataLayer.filter(
            (entry) => entry[0] === 'event' && entry[1] === 'page_view',
          ).length,
      ),
    )
    .toBe(2);
  const nextView = await page.evaluate(() =>
    (window as unknown as { dataLayer: IArguments[] }).dataLayer
      .map((entry) => Array.from(entry))
      .filter((entry) => entry[0] === 'event' && entry[1] === 'page_view')
      .at(-1),
  );
  expect(nextView?.[2]).toMatchObject({ page_location: browserUrl('/faq'), page_referrer: '' });
  expect(tagRequests).toBe(1);
  await page.getByRole('button', { name: 'Analytics preferences' }).click();
  await page.getByRole('button', { name: 'Reject analytics' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Record<string, unknown>)['ga-disable-G-TEST123']),
    )
    .toBe(true);
});
