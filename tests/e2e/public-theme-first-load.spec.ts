import { browserUrl, browserHost } from './environment';
import { randomUUID } from 'node:crypto';
import { test, expect } from './browser-test';
import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';
import { createLoginSession } from '../../src/lib/login-sessions';

test.skip(
  !process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL,
  'A dedicated test database is required',
);
test('the saved theme applies on fresh public and console loads and client navigation', async ({
  browser,
}) => {
  const user = await db.user.create({
    data: {
      email: `theme-${randomUUID()}@example.test`,
      preference: { create: { theme: 'dark' } },
    },
  });
  const login = await createLoginSession(user.id, 0, 'credentials');
  if (!login || !process.env.AUTH_SECRET) throw new Error('Test session configuration missing');
  const token = await encode({
    secret: process.env.AUTH_SECRET,
    salt: 'authjs.session-token',
    token: { sub: user.id, sessionVersion: login.sessionVersion, loginSessionId: login.id },
  });
  const workspace = await db.organization.create({
    data: {
      name: 'Theme test workspace',
      workspaceOwnerId: user.id,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  const context = await browser.newContext({ colorScheme: 'light' });
  try {
    await context.addCookies([
      { name: 'authjs.session-token', value: token, domain: browserHost, path: '/' },
    ]);
    const page = await context.newPage();
    await page.route('**/api/account/preferences', (route) => route.abort());
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as Window & { firstTheme?: string }).firstTheme =
          document.documentElement.className;
      });
    });
    const response = await page.goto(browserUrl('/overview'));
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(
      await page.evaluate(() => (window as Window & { firstTheme?: string }).firstTheme),
    ).toContain('dark');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

    await context.clearCookies({ name: 'assame-account-theme' });
    await page.evaluate(() => localStorage.removeItem('theme'));
    const publicResponse = await page.goto(browserUrl('/about'));
    expect(publicResponse?.headers()['cache-control']).toContain('no-store');
    expect(
      await page.evaluate(() => (window as Window & { firstTheme?: string }).firstTheme),
    ).toContain('dark');

    const scriptWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Encountered a script tag')) scriptWarnings.push(message.text());
    });
    await page.getByRole('button', { name: /^Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(scriptWarnings).toEqual([]);
  } finally {
    await context.close();
    await db.organization.delete({ where: { id: workspace.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});
