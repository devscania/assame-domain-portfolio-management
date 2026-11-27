import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
const email = `profile-${randomUUID()}@example.test`;
const password = 'BrowserTest!2026secure';
test.afterEach(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL)
    return;
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.organization.deleteMany({ where: { workspaceOwnerId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});
test('update a profile and sign out two devices', async ({ page, browser, verifyFixtureEmail }) => {
  const other = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `second-${email}` },
  });
  const registered = await page.request.post('/api/register', {
    headers: { Origin: browserOrigin, 'x-forwarded-for': email },
    data: {
      name: 'Initial Name',
      email,
      password,
      confirmPassword: password,
      workspace: 'Profile workspace',
    },
  });
  expect(registered.status()).toBe(200);
  await verifyFixtureEmail(email, page.request);
  const second = await other.newPage();
  for (const current of [page, second]) {
    await current.goto('/login');
    await current.getByLabel('Email address').fill(email);
    await current.getByLabel(/^Password/).fill(password);
    await current.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(current.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await current.waitForLoadState('load');
  }
  await page.goto('/account/profile');
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Updated Name');
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/settings' &&
      new URL(response.url()).searchParams.get('tab') === 'profile',
  );
  await page.getByRole('button', { name: 'Save name' }).click();
  await refreshed;
  await expect(page.getByRole('status')).toHaveText('Name saved.');
  await expect(page.locator('.sidebar-profile strong')).toHaveText('Updated Name');
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('link', { name: /Account security/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Account security', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out all devices', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm sign out all devices' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await other.request.get('/api/console?view=summary')).status()).toBe(401);
  await other.close();
});
