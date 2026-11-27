import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
const email = `password-setup-${randomUUID()}@example.test`;
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
test('a signed-in account without a password can request a setup link', async ({
  page,
  verifyFixtureEmail,
}) => {
  const registered = await page.request.post('/api/register', {
    headers: { Origin: browserOrigin, 'x-forwarded-for': email },
    data: {
      name: 'Password setup',
      email,
      password,
      confirmPassword: password,
      workspace: 'Setup workspace',
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
      passwordHash: null,
      accounts: { create: { type: 'oauth', provider: 'google', providerAccountId: randomUUID() } },
    },
  });
  await page.goto('/account/security');
  await expect(page.getByRole('heading', { name: 'Add a password' })).toBeVisible();
  await page.getByRole('button', { name: 'Email me a password setup link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your account email');
  expect(
    await db.authToken.count({ where: { userId: user.id, kind: { startsWith: 'setup:' } } }),
  ).toBe(1);
});
