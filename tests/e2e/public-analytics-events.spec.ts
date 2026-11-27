import { test, expect } from './browser-test';

test('public conversions require consent and contain only fixed non-sensitive properties', async ({
  page,
}) => {
  test.skip(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID !== 'G-TEST123',
    'Requires the test measurement ID',
  );
  let tagRequests = 0;
  await page.route('https://www.googletagmanager.com/gtag/js*', async (route) => {
    tagRequests++;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.route('**/api/register', async (route) =>
    route.fulfill({ status: 200, json: { ok: true } }),
  );
  await page.route('**/api/contact', async (route) =>
    route.fulfill({ status: 201, json: { ok: true } }),
  );
  const events = () =>
    page.evaluate(
      () =>
        (window as unknown as { dataLayer: IArguments[] }).dataLayer?.map((entry) =>
          Array.from(entry),
        ) || [],
    );
  await page.goto('/features?email=private@example.test&token=secret-token');
  expect(tagRequests).toBe(0);
  await page.getByRole('button', { name: 'Accept analytics' }).click();
  await expect.poll(() => tagRequests).toBe(1);
  await page.getByRole('link', { name: 'Create an account', exact: true }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await expect
    .poll(async () => (await events()).filter((entry) => entry[1] === 'sign_up_cta_click').length)
    .toBe(1);
  await page.getByLabel('Your name').fill('Private Person');
  await page.getByLabel('Workspace name').fill('Private Portfolio');
  await page.getByLabel('Email address').fill('private@example.test');
  await page.getByLabel('Password', { exact: true }).fill('PrivatePassword!123');
  await page.getByLabel('Confirm password').fill('PrivatePassword!123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect
    .poll(async () => (await events()).filter((entry) => entry[1] === 'sign_up').length)
    .toBe(1);
  expect((await events()).filter((entry) => entry[1] === 'registration_started')).toHaveLength(1);
  const recorded = JSON.stringify(await events());
  for (const secret of [
    'private@example.test',
    'secret-token',
    'Private Person',
    'Private Portfolio',
    'PrivatePassword!123',
  ])
    expect(recorded).not.toContain(secret);
  await page.goto('/contact');
  await page.getByLabel('Name', { exact: true }).fill('Private Person');
  await page.getByLabel('Email', { exact: true }).fill('private@example.test');
  await page.getByLabel('How can we help?').fill('Confidential portfolio inquiry about portfolio.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect
    .poll(
      async () =>
        (await events()).filter((entry) => entry[1] === 'contact_request_submitted').length,
    )
    .toBe(1);
  const contactEvents = JSON.stringify(await events());
  expect(contactEvents).not.toContain('private@example.test');
  expect(contactEvents).not.toContain('Confidential portfolio inquiry');
  await page.getByRole('button', { name: 'Analytics preferences' }).click();
  await page.getByRole('button', { name: 'Reject analytics' }).click();
  const before = (await events()).filter((entry) => entry[0] === 'event').length;
  await page.getByRole('link', { name: 'Create an account', exact: true }).first().click();
  expect((await events()).filter((entry) => entry[0] === 'event')).toHaveLength(before);
});
