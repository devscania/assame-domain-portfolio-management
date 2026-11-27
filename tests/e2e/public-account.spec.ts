import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
import { browserOrigin } from './environment';
import { chooseTheme } from './theme-controls';
const email = `public-menu-${randomUUID()}@example.test`;
test.afterEach(async () => {
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.organization.deleteMany({ where: { workspaceOwnerId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});
test('saved session follows public navigation, reloads and another tab, then sign-out', async ({
  page,
  browser,
  verifyFixtureEmail,
}) => {
  expect(
    (
      await page.request.post('/api/register', {
        headers: { Origin: browserOrigin, 'x-forwarded-for': email },
        data: {
          name: 'Public Header Tester',
          email,
          password: 'HeaderFixture!2026secure',
          confirmPassword: 'HeaderFixture!2026secure',
          workspace: 'Header fixture',
        },
      })
    ).status(),
  ).toBe(200);
  await verifyFixtureEmail(email, page.request);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill('HeaderFixture!2026secure');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  for (const route of ['/', '/about', '/features', '/blog']) {
    await page.goto(route);
    const trigger = page.getByRole('button', { name: 'Account menu for Public Header Tester' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Dashboard', exact: true })).toHaveAttribute(
      'href',
      '/overview',
    );
    await expect(page.getByRole('menuitem', { name: 'Workspace settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    await page.keyboard.press('Escape');
  }
  await chooseTheme(page, 'dark');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Account menu for Public Header Tester' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(
    page.getByRole('button', { name: 'Account menu for Public Header Tester' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '.local/public-account-mobile.png', fullPage: true });
  const other = await browser.newContext({ storageState: await page.context().storageState() });
  await other.route('**/*', (route) =>
    new URL(route.request().url()).origin === browserOrigin ? route.continue() : route.abort(),
  );
  const tab = await other.newPage();
  await tab.goto(browserOrigin + '/features');
  await tab.getByRole('button', { name: 'Account menu for Public Header Tester' }).click();
  await tab.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(tab).toHaveURL(browserOrigin + '/');
  await expect(tab.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await other.close();
});
