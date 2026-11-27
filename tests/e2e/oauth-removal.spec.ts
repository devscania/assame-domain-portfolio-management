import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { hashAuthToken } from '../../src/lib/auth-email';
const email = `oauth-remove-${randomUUID()}@example.test`;
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
test('request and confirm removal of a linked provider', async ({ page, verifyFixtureEmail }) => {
  const registered = await page.request.post('/api/register', {
    headers: { Origin: browserOrigin, 'x-forwarded-for': email },
    data: {
      name: 'Removal test',
      email,
      password,
      confirmPassword: password,
      workspace: 'Removal workspace',
    },
  });
  expect(registered.status()).toBe(200);
  await verifyFixtureEmail(email, page.request);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await page.waitForLoadState('load');
  const user = await db.user.update({
    where: { email },
    data: {
      accounts: { create: { type: 'oauth', provider: 'google', providerAccountId: randomUUID() } },
    },
  });
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Email link to disconnect Google' }).click();
  await expect(page.getByRole('status')).toContainText('Check your account email');
  const pending = await db.authToken.findFirstOrThrow({
    where: { userId: user.id, kind: { startsWith: 'unlink:google:' } },
  });
  // Supply a known token for the browser fixture; the email delivery and token lifecycle are tested separately.
  const raw = randomBytes(32).toString('base64url');
  await db.authToken.update({ where: { id: pending.id }, data: { tokenHash: hashAuthToken(raw) } });
  await page.goto(`/confirm-sign-in-removal?token=${raw}`);
  await page.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(page.getByRole('status')).toContainText('Sign-in method removed');
  expect(await db.account.count({ where: { userId: user.id } })).toBe(0);
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/login/);
});
